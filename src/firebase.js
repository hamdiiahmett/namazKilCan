import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCsYbMN9FbdxIAuf0Qrz9pK3C4efahiG-o",
  authDomain: "namaz-kil-can.firebaseapp.com",
  databaseURL: "https://namaz-kil-can-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "namaz-kil-can",
  storageBucket: "namaz-kil-can.firebasestorage.app",
  messagingSenderId: "1084666451811",
  appId: "1:1084666451811:web:aee9f49467353f4e40e556"
};

const app = initializeApp(firebaseConfig);

// Realtime Database — tüm veriler buradan
export const rtdb = getDatabase(app);
