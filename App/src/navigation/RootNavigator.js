import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';

import AppTabBar from '../components/AppTabBar';
import JobsScreen from '../screens/JobsScreen';
import ActiveJobScreen from '../screens/ActiveJobScreen';
import EarningsScreen from '../screens/EarningsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import LoginScreen from '../screens/LoginScreen';
import ActivateScreen from '../screens/ActivateScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import SuspendedScreen from '../screens/SuspendedScreen';
import LandingScreen from '../screens/LandingPagescreen';
import LogoMark from '../components/LogoMark';
import { useAuth } from '../contexts/AuthContext';
import { APP_SCHEME } from '../config';
import { COLORS } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Deep-link mapping. The onboarding email link (aviate://activate?token=...)
// routes to the Activate screen even before the driver is signed in. A web
// https fallback is included for universal/app links when configured.
const linking = {
  prefixes: [
    `${APP_SCHEME}://`,
    'https://app.aiviate.example.com',
  ],
  config: {
    screens: {
      Landing: 'landing',
      Login: 'login',
      Activate: 'activate',
      ForgotPassword: 'forgot-password',
      Tabs: {
        screens: { Jobs: 'jobs', Active: 'active', Earnings: 'earnings' },
      },
      Notifications: 'notifications',
      Profile: 'profile',
    },
  },
};

function MainTabs() {
  return (
    <Tab.Navigator tabBar={(props) => <AppTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Jobs" component={JobsScreen} />
      <Tab.Screen name="Active" component={ActiveJobScreen} />
      <Tab.Screen name="Earnings" component={EarningsScreen} />
    </Tab.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Landing" component={LandingScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Activate" component={ActivateScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  );
}

function SignedInStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={MainTabs} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ presentation: 'modal' }} />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const { status } = useAuth();

  if (status === 'restoring') {
    return (
      <View style={styles.loader}>
        <LogoMark size={56} />
        <ActivityIndicator color={COLORS.tint} size="large" style={{ marginTop: 20 }} />
      </View>
    );
  }

  return (
    <NavigationContainer linking={linking}>
      {status === 'signedIn' ? (
        <SignedInStack />
      ) : status === 'suspended' ? (
        <SuspendedScreen />
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
});
