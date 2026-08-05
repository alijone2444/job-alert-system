import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { FeedScreen } from '../screens/FeedScreen';
import { SavedScreen } from '../screens/SavedScreen';
import { PersonalizeScreen } from '../screens/PersonalizeScreen';
import { SystemStatusScreen } from '../screens/SystemStatusScreen';
import { colors } from '../theme';

export type RootTabParamList = {
  Feed: undefined;
  Saved: undefined;
  Personalize: undefined;
  Status: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return <Text style={{ fontSize: 19, opacity: focused ? 1 : 0.45 }}>{icon}</Text>;
}

/**
 * Personalization lives in its OWN tab rather than as a settings sheet over the
 * feed. Two reasons: the feed screen stays free of configuration chrome, and
 * personalisation is a place the user genuinely returns to and refines, not a
 * one-time setup step buried behind a gear icon.
 */
function FeedTab() {
  const navigation = useNavigation<any>();
  return <FeedScreen onOpenPersonalize={() => navigation.navigate('Personalize')} />;
}

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSubtle,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingTop: 6,
            height: 62,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 7 },
        }}
      >
        <Tab.Screen
          name="Feed"
          component={FeedTab}
          options={{
            tabBarLabel: 'For you',
            tabBarIcon: ({ focused }) => <TabIcon icon="🎯" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Saved"
          component={SavedScreen}
          options={{
            tabBarLabel: 'Saved',
            tabBarIcon: ({ focused }) => <TabIcon icon="⭐" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Personalize"
          component={PersonalizeScreen}
          options={{
            tabBarLabel: 'Personalize',
            tabBarIcon: ({ focused }) => <TabIcon icon="🎛️" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Status"
          component={SystemStatusScreen}
          options={{
            tabBarLabel: 'Status',
            tabBarIcon: ({ focused }) => <TabIcon icon="📊" focused={focused} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
