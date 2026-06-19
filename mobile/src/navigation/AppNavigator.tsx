import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AlertsScreen } from '../screens/AlertsScreen';
import { SystemStatusScreen } from '../screens/SystemStatusScreen';

export type RootTabParamList = {
  Jobs: undefined;
  Status: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{label}</Text>
  );
}

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#1A73E8',
          tabBarInactiveTintColor: '#5F6368',
          tabBarStyle: {
            borderTopColor: '#E8EAED',
            paddingTop: 6,
            height: 60,
          },
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
            marginBottom: 6,
          },
        }}
      >
        <Tab.Screen
          name="Jobs"
          component={AlertsScreen}
          options={{
            tabBarLabel: 'Jobs',
            tabBarIcon: ({ focused }) => <TabIcon label="💼" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Status"
          component={SystemStatusScreen}
          options={{
            tabBarLabel: 'Status',
            tabBarIcon: ({ focused }) => <TabIcon label="📊" focused={focused} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
