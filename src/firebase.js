import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";

// TODO: Lütfen Firebase projenizi oluşturduktan sonra aşağıdaki değişkenleri kendi projenize göre doldurun.
// Firebase Console > Project Settings > General > Your apps (Web) > firebaseConfig
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

// Chat için Firestore 
export const db = getFirestore(app);

// Namaz tracker & Canvas vb. anlık işlemler için Realtime Database
export const rtdb = getDatabase(app);
