import type { Messages } from '../en'

/** Bahasa Indonesia for the `hints` namespace; same shape as en/hints.ts. */
export const hints: Messages['hints'] = {
  label: 'Kemungkinan penyebab',
  fixLabel: 'Yang perlu dilakukan',
  open: 'Buka',
  causes: {
    agent: { title: 'Nexus Agent tidak tersedia', fix: 'Jalankan agent di servernya (atau perbarui ke versi yang disebut pesan), lalu ulangi run.' },
    privateNetwork: { title: 'Sistem berada di jaringan privat', fix: 'Nexus di cloud tidak dapat menjangkau alamat intranet. Pasang Nexus Agent di dalam jaringan tersebut dan tambahkan sumber melaluinya.' },
    rateLimit: { title: 'Sistem lain membatasi jumlah permintaan', fix: 'Turunkan permintaan per detik (atau baris per permintaan) pada langkah, atau naikkan batas panggilan, lalu ulangi. Nexus sudah menunggu dan mencoba ulang beberapa kali.' },
    auth: { title: 'Masuk ditolak', fix: 'Kata sandi, token, atau kunci mungkin kedaluwarsa atau berubah. Ubah kredensial sumber data dan uji koneksinya.' },
    permission: { title: 'Akun tidak memiliki izin', fix: 'Masuk berhasil, tetapi akun mungkin tidak dapat membaca (atau menulis) tabel atau endpoint tersebut. Minta administrator sistem memberikan izinnya, atau gunakan akun lain.' },
    schemaDrift: { title: 'Tabel atau kolom berubah di sumber', fix: 'Tabel atau kolom yang dipakai pipeline diganti nama atau dihapus. Uji sumber data untuk memindai ulang, lalu perbarui langkah pipeline.' },
    dataType: { title: 'Nilai tidak sesuai tipenya', fix: 'Sebagian nilai tidak dapat dikonversi (mis. teks di kolom angka atau tanggal). Tambahkan konversi di langkah Map, atau aturan Validate untuk menahan baris tersebut.' },
    timeout: { title: 'Sistem menjawab terlalu lambat', fix: 'Coba lagi nanti, atau kurangi baris per chunk atau per permintaan. Untuk tabel besar, baca secara inkremental.' },
    network: { title: 'Sistem tidak dapat dijangkau', fix: 'Periksa nama host, port, dan pengaturan sertifikat sumber data, serta pastikan sistemnya berjalan.' },
    remoteError: { title: 'Sistem lain melaporkan kesalahan', fix: 'Masalahnya ada di sisi sistem lain. Nexus sudah mencoba ulang otomatis; ulangi nanti atau hubungi administratornya.' },
    held: { title: 'Baris ditahan oleh pemeriksaan', fix: 'Tinjau baris yang ditahan di Kualitas data, perbaiki atau setujui, lalu putar ulang.' },
  },
}
