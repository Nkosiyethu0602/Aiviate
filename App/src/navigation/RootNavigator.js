import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';

import AppTabBar from '../components/AppTabBar';
import LandingScreen from '../screens/LandingScreen'; // Integrated Landing/Onboarding Screen
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
import LogoMark from '../components/LogoMark';
import { useAuth } from '../contexts/AuthContext';
import { APP_SCHEME } from '../config';
import { COLORS } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Deep-link mapping including Onboarding/Landing path
const linking = {
  prefixes: [
    `${APP_SCHEME}://`,
    'https://app.aiviate.example.com',
  ],
  config: {
    screens: {
      Landing: 'welcome',
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
    <Stack.Navigator initialRouteName="Landing" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Landing">
        {(props) => (
          <LandingScreen
            {...props}
            onFinish={() => props.navigation.navigate('Login')}
          />
        )}
      </Stack.Screen>
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