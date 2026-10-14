import type { HelpContent } from '../types'

/** Panduan dalam Bahasa Indonesia; id bab, bagian dan FAQ sama dengan en.ts. */
export const helpId: HelpContent = {
  chapters: [
    {
      id: 'start',
      title: 'Memulai',
      summary: 'Apa yang dilakukan Nexus, bagaimana pekerjaan mengalir di dalamnya, dan cara menemukan jalan Anda.',
      screen: 'overview',
      sections: [
        {
          id: 'what',
          title: 'Apa itu Nexus',
          blocks: [
            { kind: 'p', text: 'KMPlus Nexus adalah platform integrasi di balik produk KMPlus (KMS, LMS, TMS, PMS, CMS, IMS). Nexus **terhubung** ke sistem tempat data SDM Anda sudah berada, **memindahkan** data itu lewat pipeline yang diperiksa, **mengatur** siapa boleh melihat apa, dan **mengirimkannya** ke produk KMPlus, ke dataset yang bisa Anda analisis, dan ke sistem lain melalui API dan webhook.' },
            { kind: 'diagram', diagram: 'workflow', caption: 'Alur kerja. Setiap layar Nexus termasuk salah satu tahap ini; tur terpandu mengunjunginya dengan urutan yang sama.' },
            { kind: 'p', text: 'Tidak ada yang disalin manual. Pipeline yang diterbitkan berjalan sesuai jadwal (atau saat pipeline lain selesai, ada panggilan API, atau webhook masuk), memeriksa setiap baris di perjalanan, dan menahan baris yang gagal alih-alih menghilangkannya.' },
          ],
        },
        {
          id: 'terms',
          title: 'Istilah yang akan Anda temui',
          blocks: [
            {
              kind: 'table',
              head: ['Istilah', 'Arti'],
              rows: [
                ['Konektor', 'Jenis sistem yang bisa dihubungi Nexus (Talenta, SQL Server, S3, Vault …). Dipasang sekali per workspace.'],
                ['Sumber data', 'Satu koneksi beserta kredensialnya: “Database SDM (produksi)”. Dipakai sebagai sumber, tujuan, atau pengelola rahasia.'],
                ['Pipeline', 'Membaca dari sumber, memeriksa dan membentuk setiap baris, menulis ke dataset atau produk KMPlus. Digambar sebagai satu jalur.'],
                ['Dataset', 'Tabel yang disimpan Nexus untuk Anda, ditulis oleh pipeline, dibaca oleh katalog, Analitik, dan Data API.'],
                ['Eksekusi', 'Satu kali pipeline dijalankan: antre → berjalan → berhasil atau gagal, per potongan 5.000 baris.'],
                ['Karantina', 'Baris yang ditahan oleh pemeriksaan atau menunggu persetujuan. Baris yang sudah diperbaiki dikirim ulang dari langkah yang menahannya.'],
                ['Aturan bisnis', 'Pemeriksaan atau keputusan yang bisa dipakai ulang (NIK valid, tanggal selesai setelah tanggal mulai) oleh pipeline mana pun.'],
                ['Workspace', 'Ruang perusahaan Anda: anggota, peran, sumber data, dan pipeline. Lingkungan menghubungkan workspace dev, staging, dan prod.'],
                ['Nexus Agent', 'Program kecil di jaringan Anda yang menjangkau sistem yang tidak bisa dijangkau cloud (database dan API intranet).'],
              ],
            },
          ],
        },
        {
          id: 'around',
          title: 'Menemukan jalan Anda',
          blocks: [
            { kind: 'shot', screen: 'overview', caption: 'Ringkasan: 24 jam terakhir dalam satu bacaan, setiap pipeline sebagai jalur, dan yang perlu Anda tangani.' },
            {
              kind: 'list',
              items: [
                '**Rel** di kiri mengelompokkan layar menurut tugas: Bangun, Operasikan, Tata kelola, Analisis, dan Ruang kerja. Di bawah 1024 px rel dibuka dari tombol menu.',
                '**Pergi ke… (Ctrl K)** di bilah atas langsung menuju layar atau bagian pengaturan mana pun berdasarkan nama.',
                '**Pandu saya** memulai tur terpandu; **Bantuan & FAQ** membuka panduan ini.',
                '**Lonceng** menampilkan eksekusi gagal dan baris tertahan; **menu akun** mengganti tema (terang, gelap, sistem) dan bahasa (English, Bahasa Indonesia).',
                'Setiap layar punya alamat sendiri, jadi bisa Anda tandai atau kirim ke rekan kerja.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Yang Anda lihat bergantung pada peran Anda. Kontrol yang tidak bisa Anda gunakan disembunyikan; server memeriksa ulang setiap tindakan, jadi penyembunyian hanya kemudahan, bukan perlindungannya.' },
          ],
        },
        {
          id: 'first-day',
          title: 'Pipeline pertama Anda dalam lima langkah',
          blocks: [
            {
              kind: 'steps',
              items: [
                '**Konektor**: pasang konektor untuk sistem SDM Anda (mis. Talenta, SAP, atau sebuah database).',
                '**Sumber data → Tambah sumber**: isi kredensialnya lalu **Uji**. Nexus menampilkan tabel yang bisa dibacanya.',
                '**Pipeline → Pipeline baru**: pilih templat seperti **HRIS → Employee**, pilih tabel sumber, lalu buka editor.',
                '**Uji coba** di editor untuk melihat baris mengalir di setiap langkah, lalu **Terbitkan** dan atur jadwal.',
                'Pantau eksekusi pertama di **Pemantauan**, dan perbaiki baris tertahan di **Kualitas data**.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'connect',
      title: 'Hubungkan sistem Anda',
      summary: 'Konektor, sumber data, Nexus Agent untuk intranet, pengelola rahasia, dan sumber infrastruktur.',
      screen: 'sources',
      sections: [
        {
          id: 'connectors',
          title: 'Konektor',
          blocks: [
            { kind: 'shot', screen: 'connectors', caption: 'Konektor dikelompokkan per kategori, dengan pencarian.' },
            { kind: 'p', text: 'Konektor dikelompokkan sebagai **Aplikasi** (SAP SuccessFactors / HCM, Talenta, Salesforce …), **Produk KMPlus**, **Database & gudang data** (PostgreSQL, MySQL, SQL Server, Oracle, Snowflake, Supabase), **API** (REST API apa pun), **File** (unggah CSV dan Excel), **Infrastruktur** (observabilitas dan penyimpanan cloud), **Identitas & direktori** (Active Directory / LDAP), dan **Pengelola rahasia**. Pencarian mencocokkan nama dan kata kunci, jadi “excel” menemukan unggah file dan penyimpanan cloud.' },
            { kind: 'p', text: 'Memasang konektor memerlukan izin *pasang konektor* (admin). Konektor bertanda premium mungkin berbayar nanti; saat ini semua konektor gratis dipasang.' },
          ],
        },
        {
          id: 'sources',
          title: 'Sumber data',
          blocks: [
            { kind: 'shot', screen: 'sources', caption: 'Sumber data, dengan fungsi masing-masing dan kapan terakhir diuji.' },
            {
              kind: 'steps',
              items: [
                '**Tambah sumber**, pilih konektor yang terpasang dan isi kredensialnya. Kolom kata sandi bisa berisi referensi rahasia alih-alih kata sandinya (lihat Pengelola rahasia).',
                '**Uji** memeriksa koneksi dan memindai tabel serta kolomnya.',
                'Beri nama dan pilih **fungsinya**: sumber (Nexus membaca), tujuan (Nexus menulis), atau keduanya.',
                '**Jelajahi** tabel sumber dan pratinjau contoh baris (disamarkan sesuai peran Anda).',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Kredensial dienkripsi dengan kunci milik workspace Anda dan tidak pernah dikirim balik ke browser. Saat Anda mengedit sumber, rahasia tampil tersamar dan tidak berubah kecuali Anda mengetik yang baru.' },
            { kind: 'p', text: 'Nexus tidak pernah membuat atau mengosongkan tabel di database Anda sendiri. Nexus hanya menulis ke sumber data yang ditambahkan sebagai tujuan, ke tabel yang sudah ada.' },
          ],
        },
        {
          id: 'files',
          title: 'File (CSV dan Excel)',
          blocks: [
            { kind: 'p', text: 'Sumber **Unggah File** menerima file CSV, TSV, atau XLSX hingga 50 MB. File dibaca di browser Anda, diberi tipe (angka, tanggal, benar/salah), lalu disimpan sebagai tabel yang bisa dibaca Nexus seperti tabel lain. Unggah versi baru ke sumber yang sama dan eksekusi berikutnya membacanya; templat **CSV / Excel → Dataset** mengubahnya menjadi dataset dalam satu langkah.' },
          ],
        },
        {
          id: 'agent',
          title: 'Sistem di dalam jaringan Anda (Nexus Agent)',
          blocks: [
            { kind: 'diagram', diagram: 'architecture', caption: 'Nexus Agent terhubung keluar ke Nexus. Tidak ada yang di jaringan Anda perlu menerima koneksi dari internet.' },
            { kind: 'p', text: 'Database dan API di intranet Anda (alamat seperti `10.x`, `192.168.x`, atau `hr.company.local`) tidak bisa dijangkau dari cloud, dan Nexus sengaja menolaknya. Pasang **Nexus Agent** di server di dalam jaringan: agent terhubung **keluar** lewat HTTPS, mengambil pekerjaan, menjalankannya di dekat sistem Anda, dan hanya mengembalikan hasilnya.' },
            {
              kind: 'steps',
              items: [
                '**Pengaturan → Nexus Agent → Agent baru**: beri nama dan salin token sekali pakainya.',
                'Unduh agent (satu file, Node 20 atau lebih baru), tulis `nexus-agent.json` berisi token dan koneksi Anda (kata sandi bisa diambil dari variabel lingkungan), lalu jalankan. `--check` menguji koneksi terlebih dahulu.',
                'Kembali di Nexus, agent tampil online. **Sumber data → Tambah sumber → Lewat agent** menampilkan koneksinya.',
              ],
            },
            { kind: 'p', text: 'REST API intranet bekerja dengan cara yang sama: agent menyimpan URL dasar dan kredensialnya, Nexus hanya mengirim rancangan permintaan. Jika tim TI Anda lebih memilih memublikasikan API-nya, Nexus bisa memanggilnya langsung dengan sertifikat klien (mTLS), CA perusahaan, dan permintaan bertanda tangan (`X-Nexus-Signature`) dari alamat IP keluar tetap yang tercantum di **Jaringan** pada formulir REST.' },
          ],
        },
        {
          id: 'secrets',
          title: 'Pengelola rahasia',
          blocks: [
            { kind: 'diagram', diagram: 'secrets', caption: 'Hanya referensinya yang disimpan. Nilainya dibaca dari pengelola rahasia Anda saat Nexus terhubung.' },
            { kind: 'p', text: 'Simpan kata sandi di **HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, Google Secret Manager, atau Doppler**, lalu isi sumber data dengan referensi alih-alih kata sandinya:' },
            { kind: 'code', text: '{{secret:Vault prod:hr/postgres#password}}' },
            {
              kind: 'steps',
              items: [
                'Pasang konektor pengelola rahasia dan tambahkan sebagai sumber data (tampil sebagai **Rahasia** pada *Dipakai sebagai*).',
                'Di sumber data lain, klik **Gunakan rahasia** di samping kolom kata sandi, pilih pengelola dan rahasianya (hanya nama, tidak pernah nilai), lalu sisipkan referensinya.',
                '**Uji**: Nexus membaca rahasia dan terhubung. Ganti rahasia di pengelola Anda dan koneksi berikutnya memakai nilai baru dalam satu menit.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Pengelola rahasia tidak pernah menjadi data: tidak punya tabel, tidak muncul di pipeline, katalog, atau draf AI, dan nilainya tidak pernah ditulis ke database, log, catatan audit, atau browser.' },
          ],
        },
        {
          id: 'infrastructure',
          title: 'Infrastruktur: observabilitas dan penyimpanan cloud',
          blocks: [
            { kind: 'p', text: 'Kategori **Infrastruktur** membaca data operasional sebagai tabel: **Prometheus** (target, peringatan, dan kueri PromQL Anda), **Elasticsearch / OpenSearch** (indeks, inkremental pada kolom tanggal), **Datadog**, **New Relic**, **Grafana**, serta file di **penyimpanan kompatibel S3** (S3, MinIO, R2 …), **Azure Blob**, dan **Google Cloud Storage**. Folder berisi ekspor harian (`daily/*.csv`) menjadi satu tabel, sehingga file baru terus mengisi pipeline yang sama.' },
          ],
        },
      ],
    },
    {
      id: 'pipelines',
      title: 'Bangun pipeline',
      summary: 'Templat, editor, langkah, uji coba, penerbitan, jadwal, dan pemicu.',
      screen: 'pipelines',
      sections: [
        {
          id: 'anatomy',
          title: 'Anatomi pipeline',
          blocks: [
            { kind: 'diagram', diagram: 'pipeline', caption: 'Pipeline yang umum. Baris yang gagal pemeriksaan keluar dari jalur ke karantina dan kembali setelah diperbaiki.' },
            {
              kind: 'table',
              head: ['Langkah', 'Fungsinya'],
              rows: [
                ['Sumber', 'Membaca tabel, kueri, atau API. Pembacaan inkremental menyimpan watermark, sehingga setiap eksekusi hanya membaca yang berubah.'],
                ['Filter', 'Menyimpan baris yang cocok dengan kondisi (semua / salah satu, grup bersarang).'],
                ['Pemetaan', 'Mengganti nama dan mengonversi kolom: rapikan spasi, huruf besar/kecil, tanggal, angka, hash, nilai bersyarat, dan lookup ke dataset lain (mis. ORG_CODE → nama organisasi). Bisa dipetakan ke entitas Unified Data Model seperti Employee.'],
                ['Validasi', 'Memeriksa setiap baris: wajib, email, telepon, NIK, NPWP, unik, rentang, tanggal, “ada di”, hierarki manajer. Error menahan baris; peringatan hanya mencatatnya.'],
                ['Aturan', 'Menerapkan aturan bisnis dari layar Aturan, termasuk baris yang harus menunggu persetujuan.'],
                ['Router', 'Mengirim baris ke cabang berbeda berdasarkan kondisi.'],
                ['Tujuan', 'Menulis ke dataset (tambah, upsert berdasarkan kunci, atau ganti) atau ke sumber data tujuan seperti produk KMPlus.'],
              ],
            },
          ],
        },
        {
          id: 'create',
          title: 'Membuat pipeline',
          blocks: [
            { kind: 'shot', screen: 'pipelines', caption: 'Pipeline: masing-masing digambar sebagai jalur beserta status, eksekusi terakhir, dan jadwalnya.' },
            {
              kind: 'list',
              items: [
                '**Dari templat**: HRIS → Employee (memetakan SAP, Talenta, atau tabel SDM apa pun ke entitas Employee, memeriksanya dengan paket aturan SDM, menjaga dataset tetap mutakhir, dan bisa juga mengirimnya ke produk KMPlus), Active Directory → Users, dan CSV / Excel → Dataset.',
                '**Jelaskan dengan kata-kata**: tulis yang Anda inginkan dan asisten AI menyusun draf pipeline dari sumber dan tabel Anda yang sebenarnya. Draf terbuka di editor tanpa tersimpan, untuk Anda tinjau.',
                '**Dari awal**: tambahkan langkah di kanvas lalu hubungkan.',
              ],
            },
          ],
        },
        {
          id: 'editor',
          title: 'Editor',
          blocks: [
            { kind: 'shot', screen: 'editor', caption: 'Editor pipeline: langkah di kanvas, pengaturan langkah terpilih di sampingnya.' },
            {
              kind: 'list',
              items: [
                '**Uji coba** membaca sampel, menjalankan setiap langkah, dan menampilkan berapa baris yang lolos, diubah, atau ditahan di masing-masing langkah, beserta barisnya (disamarkan sesuai peran Anda).',
                '**Simpan** menyimpan draf; versi terbit tetap berjalan sampai Anda **Terbitkan**. Setiap penerbitan adalah versi yang bisa dibandingkan dan dipulihkan.',
                'Saat eksekusi gagal, **Diagnosis dengan AI** meminta asisten AI menjelaskan kegagalan dari pesan langkah (tidak pernah nilai baris) dan bisa menyarankan perbaikan sebagai draf baru.',
              ],
            },
          ],
        },
        {
          id: 'schedule',
          title: 'Jadwal dan pemicu',
          blocks: [
            {
              kind: 'table',
              head: ['Pemicu', 'Kapan berjalan'],
              rows: [
                ['Manual', '**Jalankan sekarang** di layar Pipeline atau di editor.'],
                ['Jadwal', 'Setiap jam, harian, mingguan, atau bulanan pada jam tertentu (WIB), atau ekspresi cron.'],
                ['Setelah pipeline lain', 'Saat pipeline yang dipilih selesai (berhasil, berhasil sebagian, atau selalu), untuk rangkaian seperti “karyawan, lalu unit organisasi”. Putaran ditolak.'],
                ['Webhook', 'Panggilan HTTP ke URL rahasia pipeline, mis. dari sistem SDM Anda saat data berubah.'],
                ['Data API', '`POST /api/v1/pipelines/{id}/runs` dengan kunci yang memiliki cakupan `pipelines:run`.'],
              ],
            },
            { kind: 'p', text: 'Hanya satu eksekusi per pipeline yang aktif pada satu waktu. Eksekusi memproses 5.000 baris per potongan dan menyimpan checkpoint setelah masing-masing, sehingga eksekusi panjang dilanjutkan dari titik berhenti alih-alih mulai dari awal.' },
          ],
        },
        {
          id: 'approvals',
          title: 'Persetujuan dan lingkungan',
          blocks: [
            { kind: 'p', text: 'Workspace bisa mewajibkan **orang kedua menyetujui** setiap penerbitan, atau hanya penerbitan yang menghapus atau mengganti data (**Pengaturan → Persetujuan & lingkungan**). Permintaan menunggu di **Persetujuan** pada layar Pipeline sampai admin atau steward menyetujuinya.' },
            { kind: 'p', text: '**Lingkungan** menghubungkan workspace sebagai dev → staging → prod. **Promosikan** menyalin versi terbit pipeline ke lingkungan berikutnya, mencocokkan sumber data dan aturan berdasarkan nama. Produksi terkunci secara bawaan: pipeline di sana hanya berubah lewat promosi.' },
          ],
        },
      ],
    },
    {
      id: 'rules',
      title: 'Aturan bisnis',
      summary: 'Pemeriksaan dan keputusan yang dipakai ulang di banyak pipeline.',
      screen: 'rules',
      sections: [
        {
          id: 'rules-what',
          title: 'Aturan dalam praktik',
          blocks: [
            { kind: 'shot', screen: 'rules', caption: 'Aturan bisnis beserta tempat masing-masing dipakai.' },
            { kind: 'p', text: 'Aturan adalah kondisi plus tindakan: **sertakan** atau **kecualikan** baris, **isi** atau **hitung** kolom, **arahkan** ke cabang, **beri tahu** seseorang, **wajibkan persetujuan** (baris menunggu di karantina untuk orang kedua), atau **picu** pipeline lain. Kondisi memakai penyusun yang sama dengan filter, dengan ekspresi seperti `days_between(start_date, today())`.' },
            { kind: 'p', text: 'Aturan dipakai bersama: ubah aturan sekali dan setiap pipeline yang memakainya menerapkan versi baru pada eksekusi berikutnya. Perubahan dicatat di log audit.' },
          ],
        },
      ],
    },
    {
      id: 'monitoring',
      title: 'Pantau eksekusi',
      summary: 'Eksekusi, jadwal, worker, peringatan, dan webhook.',
      screen: 'monitoring',
      sections: [
        {
          id: 'runs',
          title: 'Eksekusi dan worker',
          blocks: [
            { kind: 'shot', screen: 'monitoring', caption: 'Pemantauan: kesehatan worker dan penjadwal, lalu setiap eksekusi.' },
            {
              kind: 'list',
              items: [
                'Setiap eksekusi menampilkan pemicu, durasi, jumlah baris dibaca, ditulis, dan ditahan, serta langkah-langkahnya.',
                '**Batalkan** pekerjaan yang antre atau berjalan; **Ulangi** eksekusi yang sudah selesai (dilanjutkan dari checkpoint terakhir).',
                'Eksekusi yang gagal membuat notifikasi (lonceng) dan email ke orang yang perlu tahu; pipeline juga bisa memberi peringatan untuk baris tertahan.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'quality',
      title: 'Kualitas data',
      summary: 'Kotak masuk karantina: perbaiki, setujui, abaikan, dan kirim ulang baris tertahan.',
      screen: 'quality',
      sections: [
        {
          id: 'inbox',
          title: 'Kotak masuk karantina',
          blocks: [
            { kind: 'shot', screen: 'quality', caption: 'Baris tertahan dikelompokkan per pipeline dan pemeriksaan, dengan alasan masing-masing.' },
            {
              kind: 'steps',
              items: [
                'Buka satu kelompok untuk melihat baris yang ditahan dan alasannya.',
                '**Perbaiki** nilai langsung di tempat, **Setujui** baris yang menunggu persetujuan, atau **Abaikan** baris yang tidak boleh diteruskan.',
                '**Kirim ulang**: Nexus memutar ulang baris yang sudah diperbaiki dari langkah yang menahannya, sehingga baris tetap melewati setiap pemeriksaan berikutnya.',
              ],
            },
            { kind: 'p', text: 'Eksekusi penuh yang lebih baru menggantikan baris terbuka lama dari pipeline yang sama; perbaikan dan persetujuan terbawa ke baris yang identik. Skor kualitas per dataset dicatat setiap hari sehingga trennya terlihat.' },
          ],
        },
      ],
    },
    {
      id: 'catalog',
      title: 'Katalog dan lineage',
      summary: 'Temukan dataset atau tabel sumber apa pun, dokumentasikan, dan lihat asalnya.',
      screen: 'catalog',
      sections: [
        {
          id: 'catalog-use',
          title: 'Menggunakan katalog',
          blocks: [
            { kind: 'shot', screen: 'catalog', caption: 'Katalog: dataset dan tabel sumber beserta pemilik, tag, dan dokumentasinya.' },
            {
              kind: 'list',
              items: [
                '**Cari dengan kata-kata biasa.** “Karyawan yang bergabung bulan lalu” menemukan tabel berdasarkan nama, dokumentasi, dan nama kolom (tidak pernah nilai baris).',
                '**Lineage** menggambar pipeline mana yang membaca dan menulis setiap dataset, sampai ke tabel sumbernya.',
                'Steward menambahkan pemilik, tag, dan deskripsi, serta memilih **langsung** (kueri ke sumber setiap kali) atau **cache** (pipeline terkelola menyimpan salinan) untuk tabel sumber.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'governance',
      title: 'Tata kelola dan privasi',
      summary: 'Klasifikasi, penyamaran, filter baris, retensi, dan penghapusan (UU PDP).',
      screen: 'governance',
      sections: [
        {
          id: 'policies',
          title: 'Kebijakan dataset',
          blocks: [
            { kind: 'shot', screen: 'governance', caption: 'Tata kelola: kebijakan dataset dengan kolom yang diklasifikasikan dan disamarkan.' },
            {
              kind: 'list',
              items: [
                '**Klasifikasikan** setiap kolom sebagai publik, internal, pribadi, atau sensitif. Nexus menyarankan kelas dan penyamaran untuk kolom SDM umum seperti NIK, NPWP, gaji, dan telepon.',
                '**Samarkan** kolom untuk peran tanpa akses tak tersamar: sembunyikan nilainya, sisakan empat karakter terakhir (`••••0001`), atau ganti dengan pseudonim tetap (hash) agar hitungan dan penggabungan tetap cocok.',
                '**Filter baris per peran** membatasi baris yang dilihat suatu peran, mis. viewer hanya unit bisnisnya.',
                '**Retensi** menghapus baris yang lebih tua dari jangka waktu tertentu, diperiksa setiap jam.',
                '**Hak penghapusan** menghapus catatan satu orang di seluruh dataset, dicatat di log audit.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Penyamaran dan filter baris berlaku di mana pun data ditampilkan: pratinjau dataset, katalog, Analitik, jawaban AI, dan Data API. Admin dan data steward melihat nilai sebenarnya.' },
          ],
        },
      ],
    },
    {
      id: 'analytics',
      title: 'Analitik',
      summary: 'Dasbor dan pertanyaan berbahasa biasa atas dataset Anda.',
      screen: 'analytics',
      sections: [
        {
          id: 'dashboards',
          title: 'Dasbor dan pertanyaan',
          blocks: [
            { kind: 'shot', screen: 'analytics', caption: 'Analitik: dasbor yang dibangun dari dataset.' },
            {
              kind: 'list',
              items: [
                'Dasbor adalah kumpulan widget: angka, grafik batang atau garis, atau tabel, masing-masing atas satu dataset dengan filter, pengelompokan (juga per hari, minggu, bulan, kuartal, atau tahun), dan ukuran (jumlah, jumlah unik, total, rata-rata, min, maks).',
                '**Ajukan pertanyaan** dengan kata-kata (“jumlah karyawan per departemen tahun ini”) dan asisten menyusun draf widget yang bisa Anda simpan atau ubah.',
                'Setiap grafik punya tampilan tabel. Kueri hanya-baca, berhenti setelah 15 detik, dan mengikuti penyamaran serta filter baris Anda.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'api',
      title: 'Data API dan webhook',
      summary: 'Baca dataset dari sistem lain dan dapatkan kabar saat sesuatu terjadi.',
      screen: 'settings',
      sections: [
        {
          id: 'data-api',
          title: 'Data API',
          blocks: [
            { kind: 'p', text: 'Buat kunci di **Pengaturan → Kunci API** dengan cakupan yang diperlukan (`datasets:read`, `domains:read`, `pipelines:run`, `runs:read`) dan sebuah peran; kunci membaca sebagai peran itu, dengan penyamaran dan filter barisnya. Kunci ditampilkan sekali; Nexus hanya menyimpan hash-nya.' },
            { kind: 'code', text: 'curl -H "Authorization: Bearer nxk_…" https://<nexus-anda>/api/v1/datasets/employees?limit=100' },
            { kind: 'p', text: 'Referensi lengkap ada di `/api/v1/openapi.json`. Respons membawa header batas laju; setiap pembacaan dicatat di log audit.' },
          ],
        },
        {
          id: 'webhooks',
          title: 'Webhook',
          blocks: [
            { kind: 'p', text: '**Pengaturan → Webhook** mengirim peristiwa bertanda tangan (`run.succeeded`, `run.failed`, `dataset.updated`) ke endpoint HTTPS Anda. Verifikasi tanda tangan dengan rahasia penandatanganan; pengiriman yang gagal diulang.' },
          ],
        },
      ],
    },
    {
      id: 'kmplus',
      title: 'Produk KMPlus',
      summary: 'Mengirim data ke KMS, LMS, TMS, PMS, CMS, dan IMS.',
      sections: [
        {
          id: 'ingest',
          title: 'Ingest Contract',
          blocks: [
            { kind: 'p', text: 'Produk KMPlus adalah tujuan. Tambahkan produk sebagai sumber data (URL dan tokennya), lalu akhiri pipeline dengan langkah tujuan yang menulis ke sana. Nexus mengirim catatan lewat **Nexus Ingest Contract**; catatan yang ditolak produk ditahan di karantina pada langkah tujuan beserta alasan dari produk, sehingga bisa Anda perbaiki dan kirim ulang.' },
          ],
        },
      ],
    },
    {
      id: 'admin',
      title: 'Kelola workspace',
      summary: 'Anggota dan peran, masuk dan SSO, lingkungan, agent, AI, audit.',
      screen: 'settings',
      sections: [
        {
          id: 'roles',
          title: 'Peran',
          blocks: [
            { kind: 'diagram', diagram: 'roles', caption: 'Apa yang bisa dilakukan setiap peran. Server menegakkan tabel ini pada setiap tindakan.' },
          ],
        },
        {
          id: 'settings-tabs',
          title: 'Pengaturan',
          blocks: [
            { kind: 'shot', screen: 'settings', caption: 'Pengaturan, dengan satu tab per area.' },
            {
              kind: 'table',
              head: ['Tab', 'Yang Anda kelola'],
              rows: [
                ['Umum', 'Nama workspace.'],
                ['Anggota & peran', 'Undang orang, ubah peran, keluarkan anggota.'],
                ['Akun Anda', 'Autentikasi dua faktor dan kode cadangan Anda sendiri.'],
                ['Masuk, SSO & SCIM', 'Single sign-on (OIDC atau SAML: Entra ID, Google, Okta …) dengan domain terverifikasi, dan provisioning SCIM.'],
                ['Persetujuan & lingkungan', 'Apakah penerbitan perlu orang kedua; hubungkan workspace dev, staging, dan prod; kunci produksi.'],
                ['Nexus Agent', 'Agent di jaringan Anda dan statusnya.'],
                ['Asisten AI', 'Model open-source yang dipakai asisten: milik server, yang berjalan di dekat agent, atau nonaktif.'],
                ['Kunci API · Webhook', 'Kunci Data API dan webhook keluar.'],
                ['Log audit', 'Setiap perubahan dan setiap tampilan data asli, dengan siapa, kapan, dan dari mana.'],
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'security',
      title: 'Keamanan',
      summary: 'Cara Nexus melindungi akun, kredensial, dan data.',
      sections: [
        {
          id: 'security-facts',
          title: 'Apa yang dilindungi, dan bagaimana',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Setiap akun memakai autentikasi dua faktor** (aplikasi autentikator), kecuali masuk lewat SSO perusahaan Anda.',
                '**Kredensial** dienkripsi dengan AES-256-GCM memakai kunci yang diturunkan untuk workspace Anda, dan tidak pernah dikembalikan ke browser atau ditulis ke log.',
                '**Jaringan**: permintaan konektor dari cloud menolak alamat privat dan intranet; webhook dan penemuan SSO hanya menerima HTTPS publik.',
                '**Audit**: proses masuk, setiap perubahan, dan setiap tampilan data asli dicatat beserta alamat IP dan browser.',
                '**AI** hanya memakai model open-source. Prompt membawa nama kolom dan contoh dari kolom publik, tidak pernah data pribadi.',
              ],
            },
          ],
        },
      ],
    },
  ],
  faqGroups: [
    { id: 'basics', title: 'Dasar' },
    { id: 'connecting', title: 'Menghubungkan sistem' },
    { id: 'pipelines', title: 'Pipeline dan eksekusi' },
    { id: 'quality', title: 'Kualitas data' },
    { id: 'access', title: 'Akses, privasi, dan keamanan' },
    { id: 'ai', title: 'Asisten AI' },
  ],
  faqs: [
    { id: 'what-workspace', group: 'basics', q: 'Apa itu workspace?', a: 'Ruang perusahaan Anda di Nexus: anggota dan peran, sumber data, pipeline, dataset, dan pengaturan. Anda bisa menjadi anggota beberapa workspace dan berpindah dari rel. Data tidak pernah melintasi workspace.' },
    { id: 'language', group: 'basics', q: 'Bagaimana beralih ke English atau mode gelap?', a: 'Buka menu akun (nama Anda, kanan atas) dan pilih **Bahasa** atau **Tampilan**. Pilihan diingat di browser ini.' },
    { id: 'times', group: 'basics', q: 'Waktu ditampilkan dalam zona waktu apa?', a: 'Waktu Indonesia Barat (WIB). Jadwal juga diatur dalam WIB. Stempel waktu yang disimpan tanpa zona dianggap UTC.' },
    { id: 'tour-again', group: 'basics', q: 'Bisakah saya mengikuti tur lagi?', a: 'Bisa: **Pandu saya** di bilah atas memulainya dari awal. Tutup kapan saja dengan **Akhiri tur** atau Esc; tur dilanjutkan dari posisi terakhir jika Anda memuat ulang halaman.' },
    { id: 'missing-screen', group: 'basics', q: 'Mengapa saya tidak melihat tombol yang dimiliki rekan saya?', a: 'Peran menentukan apa yang bisa Anda lakukan. Viewer dan auditor hanya-baca, operator menjalankan tetapi tidak mengedit pipeline, hanya admin yang mengelola sumber dan anggota. Minta admin workspace mengubah peran Anda.' },
    { id: 'intranet', group: 'connecting', q: 'Database SDM kami hanya ada di jaringan perusahaan. Bisakah Nexus menjangkaunya?', a: 'Bisa, lewat **Nexus Agent** yang dipasang di dalam jaringan. Agent terhubung keluar ke Nexus lewat HTTPS, jadi tidak perlu aturan firewall masuk. Lihat *Sistem di dalam jaringan Anda*.' },
    { id: 'private-refused', group: 'connecting', q: 'Mengapa Nexus menolak alamat seperti 10.0.0.5 atau hr.local?', a: 'Alamat privat dan intranet tidak bisa dijangkau dari cloud, dan menolaknya melindungi jaringan Anda. Gunakan Nexus Agent, atau minta TI memublikasikan API dengan sertifikat klien dan IP keluar tetap milik Nexus.' },
    { id: 'store-passwords', group: 'connecting', q: 'Apakah kami harus menyimpan kata sandi database di Nexus?', a: 'Tidak. Simpan di Vault, AWS Secrets Manager, Azure Key Vault, Google Secret Manager, atau Doppler dan gunakan referensi `{{secret:…}}`. Sumber yang lewat agent menyimpan kredensial di konfigurasi agent di server Anda.' },
    { id: 'write-back', group: 'connecting', q: 'Apakah Nexus akan mengubah sistem sumber kami?', a: 'Sumber hanya dibaca. Nexus hanya menulis ke sumber data yang Anda tambahkan sebagai tujuan, ke tabel yang sudah ada, dan tidak pernah membuat atau mengosongkan tabel di sana.' },
    { id: 'unsupported', group: 'connecting', q: 'Sistem kami tidak ada di daftar konektor.', a: 'Jika punya REST API, gunakan konektor **REST API**: rancang permintaan, paging, dan cara masuk di formulirnya. Database dengan antarmuka PostgreSQL, MySQL, atau SQL Server bisa memakai konektor tersebut. Selain itu, ekspor file CSV/Excel atau minta konektor ke KMPlus.' },
    { id: 'files-update', group: 'connecting', q: 'Bagaimana memperbarui data yang berasal dari file Excel?', a: 'Unggah file baru ke sumber Unggah File yang sama; eksekusi berikutnya membacanya. Untuk ekspor berkala, taruh file di folder S3, Azure Blob, atau Google Cloud Storage dan baca foldernya sebagai satu tabel.' },
    { id: 'draft-publish', group: 'pipelines', q: 'Saya sudah menyimpan perubahan tetapi pipeline masih berjalan dengan cara lama.', a: 'Menyimpan hanya membuat draf. Eksekusi memakai versi **terbit**, jadi terbitkan drafnya (dan minta persetujuan, jika workspace Anda mewajibkan orang kedua).' },
    { id: 'run-failed', group: 'pipelines', q: 'Sebuah eksekusi gagal. Dari mana saya mulai?', a: 'Buka eksekusinya di **Pemantauan** untuk melihat langkah dan pesannya. Masalah konfigurasi (kata sandi salah, tabel tidak ada) tidak diulang; perbaiki lalu jalankan lagi. Masalah sementara diulang dari checkpoint terakhir. **Diagnosis dengan AI** di editor menjelaskannya.' },
    { id: 'incremental', group: 'pipelines', q: 'Apakah setiap eksekusi membaca seluruh tabel?', a: 'Tidak jika langkah sumber **inkremental**: Nexus mengingat nilai tertinggi kolom seperti `updated_at` dan hanya membaca baris yang lebih baru. Watermark hanya bergeser setelah seluruh eksekusi berhasil.' },
    { id: 'duplicates', group: 'pipelines', q: 'Bisakah eksekusi yang diulang membuat baris ganda?', a: 'Tidak. Penambahan ditulis per potongan dengan id eksekusi, sehingga potongan yang dilanjutkan menggantikan salinan sebelumnya; upsert mencocokkan kolom kunci Anda.' },
    { id: 'chain', group: 'pipelines', q: 'Bagaimana menjalankan pipeline B setelah pipeline A?', a: 'Di jadwal B pilih **Setelah pipeline lain** dan pilih A. B diantrekan setiap kali A selesai dengan berhasil.' },
    { id: 'deleted-employees', group: 'pipelines', q: 'Bagaimana karyawan yang keluar ditangani?', a: 'Dengan tujuan upsert dan **tandai baris yang hilang sebagai terhapus**, baris yang hilang dari sumber ditandai terhapus alih-alih dibuang. Pembacaan mengecualikannya; riwayatnya tetap ada.' },
    { id: 'held-why', group: 'quality', q: 'Mengapa baris ditahan alih-alih dimuat?', a: 'Langkah validasi atau aturan bisnis menemukan error (mis. NIK tidak valid) atau baris perlu persetujuan. Setiap baris tertahan menyebutkan pemeriksaan mana yang menahannya dan mengapa.' },
    { id: 'held-fix', group: 'quality', q: 'Jika saya memperbaiki baris tertahan, apakah baris itu melewati pemeriksaan sisanya?', a: 'Tidak. Baris yang diperbaiki diputar ulang dari langkah yang menahannya, sehingga tetap melewati setiap langkah berikutnya sebelum ditulis.' },
    { id: 'held-rerun', group: 'quality', q: 'Apa yang terjadi pada baris tertahan saat pipeline berjalan lagi?', a: 'Eksekusi penuh yang lebih baru menggantikan baris terbuka lama dari pipeline itu. Jika baris yang sama ditahan lagi, perbaikan atau persetujuan Anda sebelumnya terbawa.' },
    { id: 'masking', group: 'access', q: 'Mengapa saya melihat `••••` di beberapa kolom?', a: 'Kebijakan dataset menyamarkan kolom tersebut untuk peran Anda. Admin dan data steward melihat nilai sebenarnya; penyamaran yang sama berlaku di Analitik, jawaban AI, dan Data API.' },
    { id: 'erasure', group: 'access', q: 'Bagaimana kami menangani permintaan penghapusan sesuai UU PDP?', a: 'Admin memakai **Hak penghapusan** di layar Tata kelola untuk menghapus catatan seseorang di seluruh dataset. Permintaan dan hasilnya dicatat di log audit.' },
    { id: 'lost-2fa', group: 'access', q: 'Ponsel dengan aplikasi autentikator saya hilang.', a: 'Masuk dengan salah satu kode cadangan Anda, lalu atur autentikasi dua faktor di ponsel baru di **Pengaturan → Akun Anda**. Jika kode Anda sudah habis, minta bantuan admin workspace.' },
    { id: 'sso', group: 'access', q: 'Bisakah kami masuk dengan Microsoft Entra ID, Google, atau Okta?', a: 'Bisa. Admin menambahkan penyedia di **Pengaturan → Masuk, SSO & SCIM** (OIDC atau SAML 2.0) dan memverifikasi domain email Anda dengan catatan DNS. SCIM dapat membuat dan menonaktifkan akun secara otomatis.' },
    { id: 'audit-who', group: 'access', q: 'Bisakah kami melihat siapa yang mengubah pipeline atau melihat data gaji?', a: 'Bisa: **Pengaturan → Log audit** menampilkan setiap perubahan (dengan sebelum dan sesudah) dan setiap tampilan data asli, beserta orang, waktu, alamat IP, dan browser.' },
    { id: 'ai-data', group: 'ai', q: 'Apakah asisten AI melihat data karyawan kami?', a: 'Tidak. Prompt hanya membawa nama tabel dan kolom serta contoh dari kolom publik; kolom pribadi dan tersamar tidak disertakan, dan pesan pemeriksaan disamarkan. Jawaban adalah draf yang Anda tinjau.' },
    { id: 'ai-model', group: 'ai', q: 'Model AI apa yang dipakai Nexus?', a: 'Hanya model open-source, lewat server apa pun yang kompatibel dengan OpenAI (mis. Ollama atau vLLM): yang dikonfigurasi untuk Nexus, atau yang berjalan di dekat Nexus Agent Anda sehingga prompt tidak pernah keluar dari jaringan Anda. Admin bisa menonaktifkan asisten.' },
    { id: 'ai-off', group: 'ai', q: 'Apakah ada yang berhenti bekerja tanpa AI?', a: 'Tidak. Saran konektor dan pencarian katalog menjawab dari aturan bawaan terlebih dahulu; model hanya menambahkan. Pipeline, aturan, dan analitik berfungsi penuh tanpanya.' },
  ],
  diagrams: {
    workflow: {
      stages: [
        { title: 'Hubungkan', body: 'Konektor dan sumber data' },
        { title: 'Bangun', body: 'Pipeline dan aturan bisnis' },
        { title: 'Operasikan', body: 'Pemantauan dan kualitas data' },
        { title: 'Tata kelola', body: 'Katalog, kebijakan, audit' },
        { title: 'Kirim', body: 'Produk KMPlus, Analitik, Data API' },
      ],
    },
    architecture: {
      network: 'Jaringan perusahaan Anda',
      cloud: 'KMPlus Nexus (cloud)',
      consumers: 'Ke mana data pergi',
      systems: 'Database SDM, API intranet, MinIO',
      agent: 'Nexus Agent',
      nexus: 'Pipeline · tata kelola · katalog',
      products: 'Produk KMPlus',
      api: 'Data API · webhook · Analitik',
      secrets: 'Pengelola rahasia',
      outbound: 'hanya HTTPS keluar',
      direct: 'aplikasi cloud: SDM SaaS, S3, Datadog …',
    },
    pipeline: {
      steps: [
        { title: 'Sumber', body: 'Karyawan Talenta' },
        { title: 'Pemetaan', body: 'ke Employee' },
        { title: 'Validasi', body: 'NIK, email, tanggal' },
        { title: 'Aturan', body: 'persetujuan manajer' },
        { title: 'Tujuan', body: 'dataset · KMS' },
      ],
      quarantine: 'Karantina: perbaiki · setujui · abaikan',
      replay: 'diputar ulang dari langkah yang menahannya',
    },
    secrets: {
      source: 'Sumber data (database SDM)',
      reference: 'password = {{secret:Vault prod:hr/postgres#password}}',
      manager: 'Vault prod',
      connect: 'nilai dibaca saat terhubung, disimpan ≤ 60 dtk di memori',
      note: 'tidak disimpan · tidak dicatat di log · tidak dikirim ke browser',
    },
    roles: {
      permission: 'Izin',
      permissions: {
        'workspace:manage': 'Kelola workspace, anggota, peran, dan undangan',
        'sources:manage': 'Tambah, ubah, dan hapus sumber data',
        'connectors:manage': 'Pasang dan lepas konektor',
        'pipelines:edit': 'Buat dan ubah pipeline',
        'pipelines:run': 'Jalankan pipeline dan jeda jadwal',
        'data:preview': 'Lihat baris data (tersamar)',
        'audit:view': 'Baca log audit',
        'data:unmasked': 'Lihat kolom tersamar tanpa penyamaran',
        'governance:manage': 'Ubah kebijakan dataset',
        'data:erase': 'Hapus catatan seseorang',
        'dashboards:edit': 'Bangun dasbor Analitik',
        'rules:edit': 'Ubah aturan bisnis',
        'quality:manage': 'Perbaiki, setujui, dan kirim ulang baris tertahan',
        'catalog:edit': 'Dokumentasikan katalog',
        'api:manage': 'Kelola kunci API dan webhook',
        'pipelines:approve': 'Setujui penerbitan',
      },
    },
  },
}
