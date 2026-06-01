# Last Man Standing Mobile (Expo)

Initial React Native mobile app scaffold for Last Man Standing.

## Prerequisites
- Node 20+
- Android Studio emulator (or physical Android device with Expo Go)

## Configure API URL
Set the backend base URL via env var:

```bash
export EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8080
```

Notes:
- Android emulator: `http://10.0.2.2:8080`
- Physical device: `http://<your-lan-ip>:8080`

## Run

```bash
npm install
npm run android
```

## Current Scope
- Secure token storage (`expo-secure-store`)
- Login via `/auth/login`
- Session bootstrap via `/auth/me`
- Competitions list via `/competitions/upcoming`

## Next Steps
1. Add navigation (`expo-router`) and route-based screen structure.
2. Port competition details + pick flow.
3. Add refresh token flow + global auth interceptor.
4. Add push notifications and deep links.
