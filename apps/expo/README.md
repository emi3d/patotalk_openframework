# Situ — App Expo

Cliente Expo (React Native) para el servidor Situ. Navegación por estado, sin librería de UI, un solo cliente API (`src/api.ts`).

La app no importa el paquete npm `situ`: ese paquete depende de `pg`, LangChain y `fs`, que no corren en React Native. Expo habla con el servidor por REST + WebSocket. En una app React web, usa el paquete directo (`npm install situ`, ver `examples/react-usage.tsx` en la raíz).

## Pantallas

- **Home**: biblioteca de situaciones (`GET /situations`).
- **Detail**: roles, objetivos, vocabulario y umbral de aprobado del módulo.
- **Live session**: grabar con `expo-av`, mandar el turno por REST (`POST /sessions/:id/turn`) y escuchar la respuesta; el socket semi-live (`/live`) está conectado y muestra la transcripción en cuanto llega. Botón *Evaluate* para evaluar contra la rúbrica.
- **Progress**: racha e historial por situación (`GET /progress/:userId`).

## Correr

```bash
npm install
npx expo start
```

El servidor por default es `http://localhost:3000`. En un teléfono físico, `localhost` es el teléfono: apunta a la IP de LAN de tu computadora:

```bash
EXPO_PUBLIC_SITU_URL=http://192.168.1.10:3000 npx expo start
```

El servidor debe estar corriendo (`cd ../server && npm start`). Sin llaves funciona con los providers stub.

## Notas

- El audio de respuesta llega en base64; se guarda en `Paths.cache` y se reproduce con `expo-av`.
- `USER_ID` está hardcodeado a `demo-user` en `App.tsx` — conéctalo a tu auth (Firebase Auth, etc.) cuando lo lleves a producción.
- Typecheck: `npm run typecheck`.
