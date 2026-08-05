import React from 'react';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FeedScreen } from '../screens/FeedScreen';
import { SavedScreen } from '../screens/SavedScreen';
import { PersonalizeScreen } from '../screens/PersonalizeScreen';
import { SystemStatusScreen } from '../screens/SystemStatusScreen';
import { Icon, IconName } from '../components/Icon';
import { colors } from '../theme';

export type RootTabParamList = {
  Feed: undefined;
  Saved: undefined;
  Personalize: undefined;
  Status: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

/**
 * Icons are stroked SVG paths, not emoji — see components/Icon.tsx for why.
 * The active tab is drawn heavier as well as tinted, so the selection reads
 * even for someone who cannot distinguish the two colours.
 */
function tabIcon(name: IconName) {
  return function TabBarIcon({ focused, color }: { focused: boolean; color: string }) {
    return <Icon name={name} size={23} color={color} weight={focused ? 2.3 : 1.8} />;
  };
}

/**
 * Personalization lives in its OWN tab rather than a settings sheet over the
 * feed. Two reasons: the feed screen stays free of configuration chrome, and
 * personalisation is somewhere a user genuinely returns to and refines, not a
 * one-time step buried behind a gear icon.
 */
function FeedTab() {
  const navigation = useNavigation<any>();
  return <FeedScreen onOpenPersonalize={() => navigation.navigate('Personalize')} />;
}

export function AppNavigator() {
  const insets = useSafeAreaInsets();

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
            paddingTop: 8,
            // Grow the bar by the gesture-navigation inset instead of using a
            // fixed height — on a device with gesture nav a hard-coded height
            // put the labels underneath the system pill, striking a line
            // through "Saved" and "Personalize".
            paddingBottom: insets.bottom,
            height: 62 + insets.bottom,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 7 },
        }}
      >
        <Tab.Screen
          name="Feed"
          component={FeedTab}
          options={{ tabBarLabel: 'For you', tabBarIcon: tabIcon('target') }}
        />
        <Tab.Screen
          name="Saved"
          component={SavedScreen}
          options={{ tabBarLabel: 'Saved', tabBarIcon: tabIcon('bookmark') }}
        />
        <Tab.Screen
          name="Personalize"
          component={PersonalizeScreen}
          options={{ tabBarLabel: 'Personalize', tabBarIcon: tabIcon('sliders') }}
        />
        <Tab.Screen
          name="Status"
          component={SystemStatusScreen}
          options={{ tabBarLabel: 'Status', tabBarIcon: tabIcon('activity') }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
