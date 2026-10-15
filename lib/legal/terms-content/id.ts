import type { TermsDocument } from '../terms'

/** Syarat dan Ketentuan dalam Bahasa Indonesia (versi yang berlaku bila berbeda); id bagian sama dengan en.ts. */
export const termsId: TermsDocument = {
  title: 'Syarat dan Ketentuan',
  intro: 'Syarat ini mengatur penggunaan KMPlus Nexus oleh Anda. Bacalah sebelum melanjutkan.',
  sections: [
    {
      id: 'about',
      title: '1. Tentang syarat ini',
      body: [
        'KMPlus Nexus (“**Nexus**”, “Layanan”) adalah platform integrasi yang disediakan oleh KMPlus (“**KMPlus**”, “kami”) untuk menghubungkan, mentransformasi, mengelola, dan mendistribusikan data perusahaan, terutama data sumber daya manusia, bagi produk KMPlus dan sistem lain.',
        'Dengan membuat akun, atau dengan memilih “Saya setuju” saat diminta, Anda (“**Anda**”) menerima Syarat dan Ketentuan ini. Jika Anda menggunakan Nexus atas nama perusahaan atau organisasi lain (“**organisasi Anda**”), Anda menyatakan berwenang melakukannya dan bahwa syarat ini juga mengikat organisasi Anda.',
        'Jika organisasi Anda memiliki perjanjian tertulis tersendiri dengan KMPlus untuk Nexus (misalnya perjanjian induk layanan atau formulir pemesanan), perjanjian tersebut berlaku di atas syarat ini apabila terdapat perbedaan.',
      ],
    },
    {
      id: 'accounts',
      title: '2. Akun Anda dan keamanannya',
      body: ['Anda bertanggung jawab atas akun Anda dan segala hal yang dilakukan dengannya. Khususnya, Anda wajib:'],
      items: [
        'memberikan informasi yang benar saat mendaftar dan menjaganya tetap mutakhir;',
        'merahasiakan kata sandi, aplikasi autentikator, dan kode cadangan Anda; autentikasi dua faktor wajib untuk setiap akun yang tidak masuk melalui single sign-on organisasi Anda;',
        'tidak membagikan akun Anda atau membiarkan orang lain menggunakannya;',
        'segera memberi tahu administrator workspace Anda, dan KMPlus, jika Anda menduga ada orang lain yang menggunakan akun Anda.',
      ],
    },
    {
      id: 'workspaces',
      title: '3. Workspace, peran, dan administrator',
      body: [
        'Data di Nexus dimiliki oleh workspace. Administrator workspace menentukan siapa yang menjadi anggota, peran setiap anggota, sistem yang dihubungkan, dan cara data dikelola. Mereka dapat mengubah peran Anda atau mencabut akses Anda kapan saja.',
        'Peran Anda menentukan apa yang dapat Anda lihat dan lakukan. Jangan mencoba menjangkau data atau fungsi yang tidak diizinkan untuk peran Anda, termasuk nilai yang disamarkan atau baris yang disembunyikan dari Anda oleh filter baris.',
      ],
    },
    {
      id: 'data',
      title: '4. Data Anda',
      body: [
        '“**Data Pelanggan**” adalah data yang Anda atau organisasi Anda hubungkan ke, unggah ke, atau buat di Nexus, termasuk catatan karyawan dan data pribadi lainnya. Data Pelanggan adalah milik Anda atau organisasi Anda. Anda memberi KMPlus hak untuk menyimpan, menyalin, mengirimkan, dan memproses Data Pelanggan hanya sejauh diperlukan untuk menyediakan, mengamankan, dan mendukung Layanan bagi Anda, dan tidak untuk tujuan lain.',
        'Anda bertanggung jawab memastikan bahwa Anda berhak menghubungkan setiap sistem dan memproses data yang Anda bawa ke Nexus, termasuk dasar pemrosesan yang sah menurut hukum yang berlaku serta pemberitahuan atau persetujuan yang perlu diberikan organisasi Anda kepada karyawannya atau orang lain yang datanya diproses.',
      ],
    },
    {
      id: 'privacy',
      title: '5. Pelindungan data pribadi',
      body: [
        'Untuk data pribadi dalam Data Pelanggan, organisasi Anda adalah **pengendali data pribadi** dan KMPlus bertindak sebagai **prosesor data pribadi** atas namanya, sebagaimana dimaksud dalam Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi (“**UU PDP**”) beserta peraturan pelaksanaannya. KMPlus memproses data pribadi tersebut hanya berdasarkan instruksi terdokumentasi dari organisasi Anda, termasuk konfigurasi yang dibuat workspace Anda di Nexus.',
        'KMPlus melindungi Data Pelanggan dengan langkah teknis dan organisasional yang sesuai dengan risikonya, termasuk enkripsi kredensial yang disimpan, autentikasi dua faktor wajib, akses berbasis peran, penyamaran kolom dan filter baris, serta log audit atas perubahan dan tampilan data asli. KMPlus akan memberi tahu organisasi Anda tanpa penundaan yang tidak semestinya apabila mengetahui adanya kegagalan pelindungan yang memengaruhi data pribadinya, agar organisasi Anda dapat memenuhi kewajiban pemberitahuannya sendiri.',
        'Nexus menyediakan alat yang dapat digunakan organisasi Anda untuk memenuhi hak subjek data, seperti batas retensi dan penghapusan catatan seseorang. Data pribadi tentang Anda sebagai pengguna (nama, alamat email, catatan masuk, dan catatan audit) digunakan untuk menjalankan, mengamankan, dan mendukung Layanan.',
      ],
    },
    {
      id: 'systems',
      title: '6. Sistem yang dihubungkan, kredensial, dan Nexus Agent',
      body: [
        'Saat Anda menghubungkan suatu sistem (database, aplikasi, API, file, pengelola rahasia), Anda menyatakan bahwa Anda berwenang memberikan akses tersebut kepada Nexus dan bahwa Anda mematuhi ketentuan sistem itu sendiri. Nexus mengenkripsi kredensial yang disimpan dan tidak pernah menampilkannya kembali ke browser; Anda dapat menyimpannya di luar Nexus dengan pengelola rahasia atau Nexus Agent.',
        '**Nexus Agent** adalah perangkat lunak yang dipasang dan dijalankan organisasi Anda di dalam jaringannya sendiri. Organisasi Anda bertanggung jawab atas server tempat agent berjalan, konfigurasinya, dan kredensial yang disimpan di dalamnya. Nexus hanya menulis ke sistem yang Anda tambahkan sebagai tujuan.',
      ],
    },
    {
      id: 'use',
      title: '7. Penggunaan yang diperbolehkan',
      body: ['Anda dilarang, dan dilarang membantu orang lain untuk:'],
      items: [
        'menggunakan Nexus dengan melanggar hukum, atau untuk memproses data yang tidak berhak Anda proses;',
        'mengakses, atau mencoba mengakses, akun, workspace, sistem, atau data tanpa izin, atau mengakali keamanan, penyamaran, filter baris, persetujuan, atau kontrol lainnya;',
        'menyelidiki, memindai, atau menguji kerentanan Layanan tanpa izin tertulis dari KMPlus;',
        'mengunggah atau mengirim perangkat lunak berbahaya, atau menggunakan Nexus untuk menyerang atau membebani sistem apa pun;',
        'menyalin, mengubah, merekayasa balik, atau menjual kembali Layanan, kecuali sejauh diizinkan secara tegas oleh hukum;',
        'menggunakan cara otomatis untuk mengakses Layanan selain Data API dan webhook yang terdokumentasi, dalam batasnya.',
      ],
    },
    {
      id: 'ai',
      title: '8. Fitur AI',
      body: [
        'Nexus memiliki fitur AI opsional (draf pipeline, diagnosis eksekusi, saran konektor, pencarian katalog, dan pertanyaan di Analitik) yang memakai model open-source, dijalankan oleh KMPlus atau di dekat Nexus Agent organisasi Anda. Prompt hanya membawa nama tabel dan kolom serta contoh dari kolom publik, tidak pernah nilai yang tersamar atau bersifat pribadi.',
        'Keluaran AI bisa keliru. Keluaran tersebut selalu berupa draf: tinjau sebelum Anda menyimpan, menerbitkan, atau mengandalkannya. Administrator workspace Anda dapat menonaktifkan fitur AI.',
      ],
    },
    {
      id: 'service',
      title: '9. Layanan, perubahan, dan dukungan',
      body: [
        'KMPlus berupaya menjaga Nexus tetap tersedia dan aman, tetapi Layanan sewaktu-waktu dapat terganggu, misalnya karena pemeliharaan atau peristiwa di luar kendali KMPlus. KMPlus dapat menyempurnakan, mengubah, atau menghentikan fitur; apabila suatu perubahan secara material mengurangi Layanan yang digunakan organisasi Anda, KMPlus akan memberikan pemberitahuan yang wajar.',
        'Dukungan dan tingkat layanan, jika ada, mengikuti kesepakatan dengan organisasi Anda.',
      ],
    },
    {
      id: 'fees',
      title: '10. Biaya',
      body: ['Biaya Nexus, jika ada, ditetapkan dalam perjanjian organisasi Anda dengan KMPlus. KMPlus akan memberi pemberitahuan sebelum mengenakan biaya untuk fitur yang saat ini gratis, seperti konektor.'],
    },
    {
      id: 'confidentiality',
      title: '11. Kerahasiaan',
      body: ['Masing-masing pihak akan menjaga kerahasiaan informasi rahasia pihak lain dan menggunakannya hanya untuk keperluan Layanan. Data Pelanggan adalah informasi rahasia organisasi Anda. Ketentuan ini tidak berlaku untuk informasi yang telah menjadi publik bukan karena kesalahan pihak penerima, atau yang wajib diungkapkan menurut hukum, dalam hal mana pihak penerima akan memberi pemberitahuan sejauh diizinkan hukum.'],
    },
    {
      id: 'ip',
      title: '12. Hak kekayaan intelektual',
      body: ['KMPlus dan para pemberi lisensinya memiliki Nexus, termasuk perangkat lunak, desain, dan dokumentasinya. Syarat ini memberi Anda hak untuk menggunakan Layanan selama Anda memiliki akses; syarat ini tidak mengalihkan kepemilikan apa pun. Jika Anda memberikan masukan kepada KMPlus, KMPlus dapat menggunakannya tanpa kewajiban kepada Anda.'],
    },
    {
      id: 'termination',
      title: '13. Penangguhan dan pengakhiran',
      body: [
        'KMPlus dapat menangguhkan atau mengakhiri akses Anda apabila Anda melanggar syarat ini, apabila perjanjian organisasi Anda berakhir, atau apabila diperlukan untuk melindungi Layanan, pelanggan lain, atau Data Pelanggan. Bila memungkinkan, KMPlus akan memberi tahu Anda terlebih dahulu.',
        'Anda dapat berhenti menggunakan Nexus kapan saja. Saat suatu workspace ditutup, Data Pelanggan dikembalikan atau dihapus sesuai perjanjian organisasi Anda, dan jika tidak diatur, setelah jangka waktu yang wajar, kecuali hukum mewajibkan KMPlus untuk menyimpannya.',
      ],
    },
    {
      id: 'liability',
      title: '14. Penafian dan batasan tanggung jawab',
      body: [
        'Kecuali sebagaimana dinyatakan secara tegas dalam syarat ini atau perjanjian organisasi Anda, Layanan disediakan “sebagaimana adanya” dan “sebagaimana tersedia”, dan KMPlus tidak memberikan jaminan lain sejauh diizinkan hukum. Anda bertanggung jawab memeriksa hasil pipeline, pemeriksaan, dan keluaran AI sebelum mengandalkannya.',
        'Sejauh diizinkan hukum, KMPlus tidak bertanggung jawab atas kerugian tidak langsung atau konsekuensial, atau atas hilangnya keuntungan, pendapatan, atau data yang disebabkan oleh sistem di luar kendali KMPlus. Tidak ada ketentuan dalam syarat ini yang membatasi tanggung jawab yang menurut hukum tidak dapat dibatasi.',
      ],
    },
    {
      id: 'changes',
      title: '15. Perubahan syarat ini',
      body: ['KMPlus dapat memperbarui syarat ini. Setiap versi memiliki tanggal berlaku. Ketika versi baru diterbitkan, Nexus meminta Anda menyetujuinya sebelum melanjutkan; jika Anda tidak menyetujuinya, Anda dapat keluar dan berhenti menggunakan Layanan. Versi yang Anda setujui beserta waktunya dicatat pada akun Anda.'],
    },
    {
      id: 'law',
      title: '16. Hukum yang berlaku, penyelesaian sengketa, dan bahasa',
      body: [
        'Syarat ini diatur oleh hukum Negara Republik Indonesia. Para pihak akan terlebih dahulu berupaya menyelesaikan setiap sengketa secara musyawarah dengan itikad baik; apabila tidak selesai dalam tiga puluh (30) hari, sengketa akan diselesaikan melalui pengadilan yang berwenang di Negara Republik Indonesia, kecuali perjanjian organisasi Anda dengan KMPlus menentukan lain.',
        'Syarat ini dibuat dalam bahasa Inggris dan Bahasa Indonesia. Apabila terdapat perbedaan di antara keduanya, versi Bahasa Indonesia yang berlaku.',
      ],
    },
    {
      id: 'contact',
      title: '17. Kontak',
      body: ['Pertanyaan tentang syarat ini atau tentang data Anda di Nexus: hubungi administrator workspace Anda, atau KMPlus melalui kontak akun KMPlus organisasi Anda.'],
    },
  ],
}
