#drowsiness_detector.py
import os
import warnings

# Suppress Protobuf and TensorFlow C++ warnings on launch
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
warnings.filterwarnings("ignore", category=UserWarning, module="google.protobuf")

import cv2
import numpy as np
import mediapipe as mp
import requests
import threading
import time
import urllib.request
from flask import Flask, jsonify

# ====================================================
# CONFIGURATION
# ====================================================
ESP32_IP = "10.103.42.66"
STREAM_URL = f"http://{ESP32_IP}:81/stream"
ALARM_ON_URL = f"http://{ESP32_IP}/control?var=alarm&val=1"
ALARM_OFF_URL = f"http://{ESP32_IP}/control?var=alarm&val=0"

# Detection Thresholds
EAR_THRESHOLD = 0.21        # Eye Aspect Ratio threshold (below = closed)
EYE_CLOSED_FRAMES = 10      # Frames eyes must remain closed (~0.5s)
MAR_THRESHOLD = 0.65        # Mouth Aspect Ratio threshold (above = yawn)

# Map Redirection Cooldown (seconds)
MAP_REDIRECT_COOLDOWN = 60  
last_map_redirect_time = 0

# Landmark Indices
LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]
MOUTH = [61, 13, 291, 14]

http_session = requests.Session()

# ====================================================
# FLASK HTTP STATUS SERVER SETUP
# ====================================================
app = Flask(__name__)

current_drowsy_state = False
current_map_url = ""

@app.route('/status', methods=['GET'])
def get_status():
    global current_drowsy_state, current_map_url
    return jsonify({
        "isDrowsy": current_drowsy_state,
        "mapUrl": current_map_url
    })

def start_flask_server():
    """Runs the Flask HTTP server in a background thread."""
    try:
        print("[🚀] Starting HTTP Status Server on port 5000...")
        app.run(host='0.0.0.0', port=5000, threaded=True, debug=False, use_reloader=False)
    except Exception as e:
        print(f"[❌] Flask server error: {e}")

threading.Thread(target=start_flask_server, daemon=True).start()

# ====================================================
# ESP32 CONTROL & STREAM SETUP
# ====================================================
def configure_esp32_camera_async():
    """Reduces ESP32 camera speed and bitrate in background to prevent Wi-Fi buffer overreads."""
    try:
        http_session.get(f"http://{ESP32_IP}/control?var=framesize&val=8", timeout=1.5)
        http_session.get(f"http://{ESP32_IP}/control?var=quality&val=22", timeout=1.5)
        print("[✔] ESP32 camera speed throttled successfully.")
    except Exception:
        pass

threading.Thread(target=configure_esp32_camera_async, daemon=True).start()

class RobustMJPEGStream:
    """Direct HTTP reader that extracts raw JPEG frames with non-blocking reconnects."""
    def __init__(self, url):
        self.url = url
        self.lock = threading.Lock()
        self.frame = None
        self.connected = False
        self.running = True
        self.thread = threading.Thread(target=self._update, daemon=True)
        self.thread.start()

    def _update(self):
        headers = {'User-Agent': 'Mozilla/5.0'}
        while self.running:
            try:
                req = urllib.request.Request(self.url, headers=headers)
                stream = urllib.request.urlopen(req, timeout=2.0)
                self.connected = True
                bytes_buffer = bytes()

                while self.running:
                    chunk = stream.read(1024)
                    if not chunk:
                        break
                    bytes_buffer += chunk

                    a = bytes_buffer.find(b'\xff\xd8')
                    b = bytes_buffer.find(b'\xff\xd9')

                    if a != -1 and b != -1:
                        jpg = bytes_buffer[a:b+2]
                        bytes_buffer = bytes_buffer[b+2:]

                        img = cv2.imdecode(np.frombuffer(jpg, dtype=np.uint8), cv2.IMREAD_COLOR)
                        if img is not None:
                            with self.lock:
                                self.frame = img
            except Exception:
                self.connected = False
                time.sleep(0.5)

    def read(self):
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

    def is_connected(self):
        return self.connected

    def stop(self):
        self.running = False

# MediaPipe Initialization
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=False,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

dummy_frame = np.zeros((240, 320, 3), dtype=np.uint8)
face_mesh.process(dummy_frame)

def send_alarm_signal(url):
    try:
        http_session.get(url, timeout=0.3)
    except Exception:
        pass

def trigger_esp32_alarm(state: bool, current_state: bool):
    """Sends ON/OFF signal to ESP32 hardware and updates HTTP status variables for mobile polling."""
    global current_drowsy_state, current_map_url, last_map_redirect_time
    
    if state != current_state:
        # 1. Trigger hardware buzzer on ESP32
        target_url = ALARM_ON_URL if state else ALARM_OFF_URL
        threading.Thread(target=send_alarm_signal, args=(target_url,), daemon=True).start()
        
        # 2. Update shared HTTP states
        current_drowsy_state = state
        if state:
            current_time = time.time()
            if current_time - last_map_redirect_time > MAP_REDIRECT_COOLDOWN:
                last_map_redirect_time = current_time
                current_map_url = "https://www.google.com/maps/search/?api=1&query=petrol+station+near+me"
                print(f"[🗺️] Drowsiness flagged! Map redirect URL ready.")
        else:
            current_map_url = ""

        print(f"[📡] Status updated: isDrowsy = {state}")

    return state

def distance(p1, p2):
    return np.linalg.norm(p1 - p2)

def calculate_ear(landmarks, eye_indices, img_w, img_h):
    pts = np.array([(landmarks[idx].x * img_w, landmarks[idx].y * img_h) for idx in eye_indices])
    v1 = distance(pts[1], pts[5])
    v2 = distance(pts[2], pts[4])
    h = distance(pts[0], pts[3])
    return (v1 + v2) / (2.0 * h)

def calculate_mar(landmarks, mouth_indices, img_w, img_h):
    pts = np.array([(landmarks[idx].x * img_w, landmarks[idx].y * img_h) for idx in mouth_indices])
    v = distance(pts[1], pts[3])
    h = distance(pts[0], pts[2])
    return v / h

# State Variables
closed_counter = 0
alarm_active = False
frame_count = 0
last_alert_text = ""
ear_text = "EAR: --"
mar_text = "MAR: --"

print(f"[+] Launching stream from {STREAM_URL}...")
stream = RobustMJPEGStream(STREAM_URL)

cv2.namedWindow("ESP32-CAM Driver Fatigue Monitor", cv2.WINDOW_NORMAL)
loading_screen = np.zeros((240, 320, 3), dtype=np.uint8)

while True:
    frame = stream.read()

    if frame is None:
        canvas = loading_screen.copy()
        cv2.putText(canvas, "Connecting to ESP32...", (30, 120),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        cv2.imshow("ESP32-CAM Driver Fatigue Monitor", canvas)
        if cv2.waitKey(30) & 0xFF == ord('q'):
            break
        continue

    frame_count += 1
    should_alarm = False

    if frame_count % 2 == 0:
        processing_frame = cv2.resize(frame, (320, 240))
        rgb_frame = cv2.cvtColor(processing_frame, cv2.COLOR_BGR2RGB)
        results = face_mesh.process(rgb_frame)

        if results.multi_face_landmarks:
            for face_landmarks in results.multi_face_landmarks:
                landmarks = face_landmarks.landmark

                left_ear = calculate_ear(landmarks, LEFT_EYE, 320, 240)
                right_ear = calculate_ear(landmarks, RIGHT_EYE, 320, 240)
                avg_ear = (left_ear + right_ear) / 2.0
                mar = calculate_mar(landmarks, MOUTH, 320, 240)

                if avg_ear < EAR_THRESHOLD:
                    closed_counter += 1
                else:
                    closed_counter = 0

                is_yawning = mar > MAR_THRESHOLD

                if closed_counter >= EYE_CLOSED_FRAMES or is_yawning:
                    should_alarm = True
                    last_alert_text = "DROWSINESS DETECTED!" if closed_counter >= EYE_CLOSED_FRAMES else "YAWNING DETECTED!"
                else:
                    last_alert_text = ""

                ear_text = f"EAR: {avg_ear:.2f}"
                mar_text = f"MAR: {mar:.2f}"
        else:
            closed_counter = 0
            last_alert_text = ""
            ear_text = "EAR: N/A"
            mar_text = "MAR: N/A"

        alarm_active = trigger_esp32_alarm(should_alarm, alarm_active)

    cv2.putText(frame, ear_text, (30, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    cv2.putText(frame, mar_text, (30, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    
    if last_alert_text:
        cv2.putText(frame, last_alert_text, (30, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 3)

    cv2.imshow("ESP32-CAM Driver Fatigue Monitor", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        trigger_esp32_alarm(False, True)
        break

stream.stop()
cv2.destroyAllWindows()