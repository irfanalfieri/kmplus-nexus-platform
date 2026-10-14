import type { Messages } from '../en'

/** Bahasa Indonesia for "Guide me" and the Help & FAQ page chrome; same shape as en/tour.ts. */
export const tour: Messages['tour'] = {
  guideMe: 'Pandu saya',
  guideMeLabel: 'Mulai tur terpandu',
  help: 'Bantuan & FAQ',
  helpLabel: 'Buka Bantuan & FAQ',
  workflow: 'Kemajuan alur kerja',
  progress: 'Langkah {step} dari {total}',
  current: 'Anda di sini',
  done: 'selesai',
  end: 'Akhiri tur',
  back: 'Kembali',
  next: 'Lanjut',
  finish: 'Selesai',
  readMore: 'Baca selengkapnya di Bantuan',
  showMe: 'Kembali ke {screen}',
  notVisible: 'Kontrol ini belum tampil untuk peran Anda atau di workspace ini, jadi tur menunjuk judul layar.',
  stages: {
    home: 'Beranda',
    connect: 'Hubungkan',
    build: 'Bangun',
    operate: 'Operasikan',
    govern: 'Tata kelola',
    analyze: 'Analisis & administrasi',
  },
  steps: {
    welcome: {
      title: 'Selamat datang di Nexus',
      body: 'Nexus memindahkan data SDM dari sistem yang sudah Anda jalankan ke produk KMPlus dan dataset Anda sendiri: diperiksa, dikelola, dan terjadwal. Tur ini menyusuri alur kerja secara berurutan. Anda tetap bisa bekerja selama tur berjalan.',
    },
    lines: {
      title: 'Setiap pipeline adalah satu jalur',
      body: 'Ringkasan menggambar tiap pipeline dari sumbernya sampai tujuan tulisnya. Jalur yang trip gagal pada eksekusi terakhir; jalur yang tertahan punya baris yang menunggu di karantina. Jalur yang trip tampil paling atas.',
    },
    needs: {
      title: 'Yang perlu Anda tangani',
      body: 'Baris tertahan, persetujuan yang menunggu orang kedua, dan eksekusi gagal terkumpul di sini, jadi layar pertama setiap hari juga daftar tugas Anda.',
    },
    connectors: {
      title: '1 · Pasang konektor',
      body: 'Konektor adalah jenis sistem yang bisa dihubungi Nexus: aplikasi SDM, database, API, file, penyimpanan cloud, alat observabilitas, dan pengelola rahasia. Cari atau saring per kategori, lalu pasang yang Anda perlukan.',
    },
    sources: {
      title: '2 · Tambahkan sumber data',
      body: 'Sumber data adalah satu koneksi beserta kredensialnya: akun Talenta, database SDM, folder di S3. Uji koneksinya dan Nexus menampilkan tabel-tabelnya. Sistem di dalam jaringan Anda terhubung lewat Nexus Agent.',
    },
    pipelinesNew: {
      title: '3 · Bangun pipeline',
      body: 'Pipeline membaca dari sumber, memeriksa dan membentuk setiap baris, lalu menulis ke dataset atau produk KMPlus. Mulai dari templat, jelaskan dengan kata-kata untuk draf AI, atau gambar langkah demi langkah.',
    },
    pipelinesBoard: {
      title: 'Jalankan, jadwalkan, dan terbitkan',
      body: 'Setiap pipeline menampilkan alur, status, dan eksekusi terakhirnya. Perubahan disimpan sebagai draf sampai Anda menerbitkannya; workspace dapat mewajibkan orang kedua menyetujui setiap penerbitan.',
    },
    rules: {
      title: '4 · Aturan bisnis',
      body: 'Aturan adalah pemeriksaan dan keputusan yang dipakai ulang di banyak pipeline: NIK yang valid, tanggal selesai setelah tanggal mulai, manajer yang perlu persetujuan. Baris yang melanggar aturan ditahan, bukan hilang.',
    },
    monitoring: {
      title: '5 · Pantau eksekusi',
      body: 'Semua eksekusi, jadwal, dan worker latar belakang di satu tempat. Batalkan eksekusi yang antre, ulangi yang sudah selesai, atau buka langkah-langkahnya untuk melihat ke mana baris pergi.',
    },
    quality: {
      title: '6 · Perbaiki baris tertahan',
      body: 'Kotak masuk karantina menampung baris yang gagal pemeriksaan atau menunggu persetujuan. Perbaiki nilainya, setujui atau abaikan, lalu kirim ulang: eksekusi masuk kembali di langkah yang menahannya.',
    },
    catalog: {
      title: '7 · Temukan dan dokumentasikan data',
      body: 'Katalog memuat setiap dataset dan tabel sumber beserta kolom, pemilik, dokumentasi, dan lineage-nya. Cari dengan kata-kata biasa: “siapa yang bergabung bulan lalu” menemukan tabel yang tepat.',
    },
    governance: {
      title: '8 · Kelola akses',
      body: 'Klasifikasikan kolom, samarkan data pribadi, dan saring baris per peran, sehingga viewer hanya melihat unitnya dan tidak pernah melihat NIK lengkap. Aturan yang sama berlaku untuk Data API dan jawaban AI.',
    },
    analytics: {
      title: '9 · Analisis',
      body: 'Buat dasbor dari dataset Anda, atau ajukan pertanyaan dengan kata-kata. Grafik mengikuti penyamaran dan filter baris setiap pembaca, dan setiap grafik punya tampilan tabel.',
    },
    settings: {
      title: '10 · Kelola workspace',
      body: 'Anggota dan peran, single sign-on dan SCIM, lingkungan (dev → staging → prod), Nexus Agent, model AI, kunci Data API, webhook, dan log audit.',
    },
    jump: {
      title: 'Pergi ke mana saja dengan Ctrl K',
      body: 'Ketik nama layar atau bagian pengaturan mana pun untuk langsung menuju ke sana.',
    },
    finish: {
      title: 'Bantuan selalu tersedia',
      body: 'Bantuan & FAQ berisi panduan lengkap dengan diagram, tangkapan layar, dan jawaban atas pertanyaan umum. Mulai ulang tur ini kapan saja dari Pandu saya.',
    },
  },
  page: {
    searchLabel: 'Cari di panduan',
    searchPlaceholder: 'Cari di panduan dan FAQ',
    contents: 'Di halaman ini',
    noMatch: 'Tidak ada bagian panduan yang cocok dengan “{query}”.',
    matches: '{count} bagian cocok',
    openScreen: 'Buka {screen}',
    startTour: 'Ikuti tur terpandu',
    startTourBody: 'Enam belas langkah singkat di layar yang sebenarnya, sesuai urutan alur kerja.',
    faqTitle: 'Pertanyaan yang sering diajukan',
    faqCount: '{count} pertanyaan',
    chapters: '{count} bab',
    sections: '{count} bagian',
    guidePart: 'Panduan produk',
    faqPart: 'FAQ',
    faqIntro: 'Jawaban singkat atas pertanyaan yang paling sering diajukan, dikelompokkan per topik. Bab-bab panduan di atas menjelaskan setiap topik secara lengkap.',
    faqTopics: 'Topik FAQ',
    inChapter: 'Bagian dari {title}',
    chapterNumber: 'Bab {n}:',
    clearSearch: 'Hapus pencarian',
    screenshot: 'Tangkapan layar: {caption}',
    figure: 'Gambar',
    diagram: 'Diagram',
    backToTop: 'Kembali ke atas',
    roleCan: 'Bisa',
    roleCannot: 'Tidak bisa',
  },
}
