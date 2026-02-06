import {initializeApp} from "firebase/app";
import {getAuth, GoogleAuthProvider} from "firebase/auth";
import {getFirestore} from "firebase/firestore";
import {getFunctions} from "firebase/functions";

const env = import.meta.env;
const readEnv = (...keys) => keys.map((key) => env[key]).find(Boolean);

const firebaseConfig = {
  apiKey: readEnv("VITE_FIREBASE_API_KEY", "VITE_FIRESTORE_API_KEY"),
  authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIRESTORE_AUTH_DOMAIN"),
  projectId: readEnv("VITE_FIREBASE_PROJECT_ID", "VITE_FIRESTORE_PROJECT_ID"),
  storageBucket: readEnv(
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIRESTORE_STORAGE_BUCKET",
  ),
  messagingSenderId: readEnv(
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIRESTORE_MESSAGING_SENDER_ID",
  ),
  appId: readEnv("VITE_FIREBASE_APP_ID", "VITE_FIRESTORE_APP_ID"),
  measurementId: readEnv(
    "VITE_FIREBASE_MEASUREMENT_ID",
    "VITE_FIRESTORE_MEASUREMENT_ID",
  ),
};

const requiredKeys = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
];

const missingKeys = requiredKeys.filter((key) => !firebaseConfig[key]);

let app = null;
let firebaseInitError = "";

try {
  if (missingKeys.length > 0) {
    throw new Error(
      `Missing Firebase config values: ${missingKeys.join(", ")}. ` +
        "Check your .env file. In Vite, client env vars must be prefixed with VITE_.",
    );
  }
  app = initializeApp(firebaseConfig);
} catch (err) {
  firebaseInitError = err?.message || "Failed to initialize Firebase.";
}

export {firebaseInitError};
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app
  ? getFunctions(app, readEnv("VITE_FIREBASE_FUNCTIONS_REGION") || "europe-west1")
  : null;
export const googleProvider = app ? new GoogleAuthProvider() : null;
export const firebaseProjectId = firebaseConfig.projectId || "";
