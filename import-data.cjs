const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const data = require('./data-santri.json');

// Inisialisasi Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function importData() {
  console.log('⏳ Sedang mengunggah data...');
  
  for (const item of data) {
    const { id, ...rest } = item;
    // Memasukkan data ke koleksi 'murid' dengan Document ID sesuai id kartu
    await db.collection('murid').doc(id).set(rest);
    console.log(`✅ Berhasil input: ${item.nama}`);
  }
  
  console.log('🚀 Semua data berhasil diupload ke Firebase!');
  process.exit();
}

importData().catch(console.error);