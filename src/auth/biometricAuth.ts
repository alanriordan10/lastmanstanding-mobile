import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { getAccessToken, getRefreshToken } from './tokenStorage';

const BIOMETRIC_ENABLED_KEY = 'lms.biometricEnabled';

export type BiometricAvailability = {
  available: boolean;
  enrolled: boolean;
  label: string;
};

export async function getBiometricAvailability(): Promise<BiometricAvailability> {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  const enrolled = compatible ? await LocalAuthentication.isEnrolledAsync() : false;
  const types = compatible ? await LocalAuthentication.supportedAuthenticationTypesAsync() : [];
  const label = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
    ? 'Fingerprint / biometric'
    : 'Biometric';

  return { available: compatible && enrolled, enrolled, label };
}

export async function isBiometricLoginEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)) === 'true';
}

export async function setBiometricLoginEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');
  } else {
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
  }
}

export async function hasStoredTokensForBiometricLogin(): Promise<boolean> {
  const [accessToken, refreshToken] = await Promise.all([getAccessToken(), getRefreshToken()]);
  return Boolean(accessToken || refreshToken);
}

export async function authenticateWithBiometrics(label = 'Sign in'): Promise<boolean> {
  const availability = await getBiometricAvailability();
  if (!availability.available) return false;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: `${label} with fingerprint or biometrics`,
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use device passcode',
    disableDeviceFallback: false,
  });

  return result.success;
}
