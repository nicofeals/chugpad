// Firebase is only downloaded when firebase-config.js holds real values (see connect() in cloud.ts).
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

export default firebase;
