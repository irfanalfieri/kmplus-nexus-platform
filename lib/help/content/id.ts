import type { HelpContent } from '../types'

/** Panduan dalam Bahasa Indonesia; id dan bentuk blok sama dengan en.ts. */
export const helpId: HelpContent = {
  chapters: [
    // ── 1 ───────────────────────────────────────────────────────────────────
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
            { kind: 'diagram', diagram: 'workflow', caption: 'Alur kerja. Setiap layar Nexus termasuk salah satu tahap ini; tur terpandu mengunjunginya dengan urutan yang sama, begitu juga bab-bab panduan ini.' },
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
                ['Workspace', 'Ruang perusahaan Anda: anggota, peran, sumber data, dan pipeline.'],
                ['Lingkungan', 'Workspace yang ditandai Development, Staging, atau Production. Pipeline berpindah dari satu ke berikutnya lewat promosi.'],
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
                '**Lonceng** menampilkan eksekusi gagal dan baris tertahan; **menu akun** mengganti tema dan bahasa serta untuk keluar.',
                '**Pengalih workspace** di bawah logo berpindah antar-workspace dan lingkungan Anda.',
                'Setiap layar punya alamat sendiri, jadi bisa Anda tandai atau kirim ke rekan kerja.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Yang Anda lihat bergantung pada peran Anda. Kontrol yang tidak bisa Anda gunakan disembunyikan; server memeriksa ulang setiap tindakan, jadi penyembunyian hanya kemudahan, bukan perlindungannya.' },
          ],
        },
        {
          id: 'overview',
          title: 'Membaca Ringkasan',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Bacaan** menghitung 24 jam terakhir: eksekusi, kegagalan, baris ditulis, baris ditahan, dan dataset.',
                '**Jalur** menggambar setiap pipeline dari sumbernya sampai tujuan tulisnya. Jalur merah (trip) gagal pada eksekusi terakhir atau menahan baris; jalur teal aktif. Jalur yang trip tampil paling atas.',
                '**Perlu Anda tangani** mengumpulkan baris tertahan, persetujuan yang menunggu orang kedua, eksekusi gagal, dan sumber yang terputus, masing-masing dengan tautan ke tempat memperbaikinya.',
                '**Siapkan ruang kerja Anda** mencentang langkah awal (konektor, sumber, pipeline, eksekusi pertama, jadwal) sampai semuanya selesai.',
                '**Berikutnya** menampilkan eksekusi terjadwal berikutnya.',
              ],
            },
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
                '**Uji pada sampel** di editor untuk melihat baris mengalir di setiap langkah, lalu **Simpan & publikasikan** dan atur jadwal.',
                'Pantau eksekusi pertama di **Pemantauan**, dan perbaiki baris tertahan di **Kualitas data**.',
              ],
            },
          ],
        },
        {
          id: 'prefs',
          title: 'Bahasa, tema, dan waktu',
          blocks: [
            { kind: 'p', text: 'Menu akun (nama Anda, kanan atas) mengganti antarmuka antara **English** dan **Bahasa Indonesia** serta tema antara **terang**, **gelap**, dan **sistem**. Pilihan diingat di browser ini. Data, nama kolom, dan pengenal tidak pernah diterjemahkan.' },
            { kind: 'p', text: 'Waktu ditampilkan dalam **Waktu Indonesia Barat (WIB)**, dan jadwal diatur dalam WIB. Stempel waktu yang disimpan tanpa zona dianggap UTC.' },
          ],
        },
      ],
    },
    // ── 2 ───────────────────────────────────────────────────────────────────
    {
      id: 'connect',
      title: 'Hubungkan sistem Anda',
      summary: 'Konektor, sumber data, file, Nexus Agent untuk intranet, pengelola rahasia, sumber infrastruktur, dan tujuan.',
      screen: 'sources',
      sections: [
        {
          id: 'connectors',
          title: 'Konektor dan kategori',
          blocks: [
            { kind: 'shot', screen: 'connectors', caption: 'Konektor dikelompokkan per kategori, dengan pencarian.' },
            {
              kind: 'table',
              head: ['Kategori', 'Contoh'],
              rows: [
                ['Aplikasi', 'SAP SuccessFactors / HCM, Talenta (Mekari), Salesforce'],
                ['Produk KMPlus', 'KMS, LMS, TMS, PMS, CMS, IMS (tujuan)'],
                ['Database & gudang data', 'PostgreSQL, MySQL, Microsoft SQL Server, Oracle, Snowflake, Supabase'],
                ['API', 'REST API apa pun, dirancang lewat formulir'],
                ['File', 'Unggah CSV dan Excel'],
                ['Infrastruktur', 'Prometheus, Elasticsearch / OpenSearch, Datadog, New Relic, Grafana, penyimpanan kompatibel S3, Azure Blob, Google Cloud Storage'],
                ['Identitas & direktori', 'Active Directory / LDAP'],
                ['Pengelola rahasia', 'HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, Google Secret Manager, Doppler'],
              ],
            },
            { kind: 'p', text: 'Pencarian mencocokkan nama dan kata kunci dalam bahasa Inggris dan Indonesia, jadi “excel” menemukan unggah file dan penyimpanan cloud. Memasang konektor memerlukan izin *pasang konektor* (admin). Konektor bertanda premium mungkin berbayar nanti; saat ini semua konektor gratis dipasang.' },
          ],
        },
        {
          id: 'sources',
          title: 'Tambahkan sumber data',
          blocks: [
            { kind: 'shot', screen: 'sources', caption: 'Sumber data, dengan fungsi masing-masing dan kapan terakhir diuji.' },
            {
              kind: 'steps',
              items: [
                '**Tambah sumber** (atau **Tambah tujuan**), pilih konektor yang terpasang dan isi kredensialnya. Kolom kata sandi bisa berisi referensi rahasia alih-alih kata sandinya (lihat Pengelola rahasia).',
                '**Uji** memeriksa koneksi dan memindai tabel serta kolomnya.',
                'Beri nama dan pilih **fungsinya**: sumber (Nexus membaca), tujuan (Nexus menulis), atau keduanya.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Kredensial dienkripsi dengan kunci milik workspace Anda dan tidak pernah dikirim balik ke browser. Saat Anda mengedit sumber, rahasia tampil tersamar dan tidak berubah kecuali Anda mengetik yang baru.' },
          ],
        },
        {
          id: 'browse',
          title: 'Uji, jelajahi, dan pratinjau',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Jelajahi tabel** menampilkan setiap tabel beserta kolom dan tipenya, serta pratinjau contoh baris (disamarkan sesuai peran Anda).',
                '**Uji ulang** setelah kata sandi atau skema berubah; daftar tabel diperbarui.',
                'Sumber yang dipakai pipeline tidak bisa dihapus sampai pipeline berhenti memakainya (termasuk draf).',
                'Nexus tidak pernah membuat atau mengosongkan tabel di database Anda sendiri. Nexus hanya menulis ke sumber data yang ditambahkan sebagai tujuan, ke tabel yang sudah ada.',
              ],
            },
          ],
        },
        {
          id: 'files',
          title: 'File: CSV dan Excel',
          blocks: [
            { kind: 'p', text: 'Sumber **Unggah File** menerima file CSV, TSV, atau XLSX hingga 50 MB. File dibaca di browser Anda, diberi tipe (angka, tanggal, benar/salah), lalu disimpan sebagai tabel yang bisa dibaca Nexus seperti tabel lain.' },
            {
              kind: 'list',
              items: [
                '**Unggah file** pada sumber: pilih sheet untuk file Excel, lalu **ganti** tabelnya atau **tambahkan** ke tabel.',
                'Eksekusi pipeline berikutnya membaca baris baru; templat **CSV / Excel → Dataset** mengubah unggahan menjadi dataset dalam satu langkah.',
                'Untuk ekspor berkala, taruh file di folder penyimpanan cloud (lihat Infrastruktur).',
              ],
            },
          ],
        },
        {
          id: 'agent',
          title: 'Sistem di dalam jaringan Anda: Nexus Agent',
          blocks: [
            { kind: 'diagram', diagram: 'architecture', caption: 'Nexus Agent terhubung keluar ke Nexus. Tidak ada yang di jaringan Anda perlu menerima koneksi dari internet.' },
            { kind: 'p', text: 'Database dan API di intranet Anda (alamat seperti `10.x`, `192.168.x`, atau `hr.company.local`) tidak bisa dijangkau dari cloud, dan Nexus sengaja menolaknya. Pasang **Nexus Agent** di server di dalam jaringan: agent terhubung **keluar** lewat HTTPS, mengambil pekerjaan, menjalankannya di dekat sistem Anda, dan hanya mengembalikan hasilnya.' },
            {
              kind: 'steps',
              items: [
                '**Pengaturan → Nexus Agent → Buat agent**: beri nama dan salin konfigurasinya (ditampilkan sekali, beserta tokennya).',
                'Unduh agent (satu file, Node 20 atau lebih baru), tulis `nexus-agent.json` berisi token dan koneksi Anda (kata sandi bisa diambil dari variabel lingkungan), lalu jalankan. `--check` menguji koneksi terlebih dahulu.',
                'Kembali di Nexus, agent tampil online beserta koneksinya; **Tambah sebagai sumber** menjadikan satu koneksi sebuah sumber data. Uji di sana untuk memindai tabelnya.',
              ],
            },
            { kind: 'p', text: 'Sumber lewat agent menyimpan kata sandinya di konfigurasi agent di server Anda; Nexus tidak menyimpan satu pun.' },
          ],
        },
        {
          id: 'intranet',
          title: 'API intranet',
          blocks: [
            { kind: 'p', text: 'REST API intranet bekerja lewat agent dengan cara yang sama: agent menyimpan URL dasar dan kredensialnya, Nexus hanya mengirim rancangan permintaan (path, paging, field). Permintaan selalu tetap berada di bawah URL dasar milik agent.' },
            { kind: 'p', text: 'Jika tim TI Anda lebih memilih memublikasikan API-nya, Nexus bisa memanggilnya langsung. Tab **Jaringan** pada formulir REST mengatur sertifikat klien (mTLS), CA perusahaan, dan permintaan bertanda tangan (`X-Nexus-Signature`), serta mencantumkan alamat IP keluar tetap milik Nexus untuk firewall Anda.' },
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
            {
              kind: 'list',
              items: [
                '**Prometheus**: target, peringatan, aturan, dan satu tabel per kueri PromQL yang Anda beri nama.',
                '**Elasticsearch / OpenSearch** (dan Elastic APM): setiap indeks yang cocok dengan pola; inkremental pada kolom tanggal seperti `@timestamp`.',
                '**Datadog**, **New Relic**, dan **Grafana**: monitor, SLO, layanan APM, isu peringatan, dasbor, serta kueri metrik atau NRQL Anda sendiri.',
                '**Penyimpanan kompatibel S3** (S3, MinIO, R2 …), **Azure Blob**, dan **Google Cloud Storage**: setiap file CSV, TSV, JSON, NDJSON, atau XLSX menjadi tabel, dan folder berisi satu format (`daily/*.csv`) menjadi satu tabel, sehingga ekspor harian baru terus mengisi pipeline yang sama.',
              ],
            },
          ],
        },
        {
          id: 'destinations',
          title: 'Tujuan: produk KMPlus, database Anda, dan REST API',
          blocks: [
            { kind: 'p', text: 'Produk KMPlus adalah tujuan. Tambahkan produk sebagai sumber data (URL dan tokennya), lalu akhiri pipeline dengan langkah tujuan yang menulis ke sana. Nexus mengirim catatan lewat **Nexus Ingest Contract**; catatan yang ditolak produk ditahan di karantina pada langkah tujuan beserta alasan dari produk, sehingga bisa Anda perbaiki dan kirim ulang.' },
            { kind: 'p', text: 'Sumber PostgreSQL, MySQL, dan Supabase yang ditambahkan sebagai tujuan juga bisa menerima baris (tambah atau upsert ke tabel yang sudah ada).' },
            { kind: 'p', text: '**REST API** juga bisa menerima baris: tambahkan API melalui **Sumber data → Tambah tujuan → REST API** (URL dasar, proses masuk, header, variabel, dan tab Jaringan, sama seperti untuk membaca). Permintaannya sendiri (metode, path, dan body) dirancang di langkah Tujuan pipeline (lihat 3.6). API di dalam jaringan Anda dijangkau melalui Nexus Agent 1.3.0 atau lebih baru dengan `"writable": true` pada koneksinya.' },
            { kind: 'note', tone: 'info', text: 'Sumber data yang ditambahkan sebagai tujuan tetapi jenisnya belum dapat ditulisi Nexus tetap terlihat di langkah Tujuan, berwarna redup, agar Anda tahu mengapa tidak dapat dipilih.' },
          ],
        },
      ],
    },
    // ── 3 ───────────────────────────────────────────────────────────────────
    {
      id: 'pipelines',
      title: 'Bangun pipeline',
      summary: 'Templat, editor, langkah, beberapa sumber dengan Gabung dan Satukan, Agregasi dan Hapus duplikat, pemeriksaan, tujuan, penerbitan, jadwal, persetujuan, serta lingkungan dengan promosi.',
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
                ['Pemetaan', 'Mengganti nama dan mengonversi kolom, dan bisa memetakan ke entitas Unified Data Model seperti Employee.'],
                ['Validasi', 'Memeriksa setiap baris. Error menahan baris; peringatan hanya mencatatnya.'],
                ['Aturan', 'Menerapkan aturan bisnis dari layar Aturan, termasuk baris yang harus menunggu persetujuan.'],
                ['Router', 'Mengirim baris ke cabang berbeda berdasarkan kondisi.'],
                ['Gabung (join)', 'Menambahkan kolom dari sumber lain berdasarkan kunci, mis. gaji dari API payroll untuk setiap karyawan (lihat Beberapa sumber).'],
                ['Satukan (union)', 'Menumpuk baris dari beberapa sumber, mis. dua sistem HR, dan mencatat asal setiap baris.'],
                ['Agregasi', 'Satu baris per kelompok dengan jumlah, total, rata-rata, dan lainnya, mis. jumlah karyawan per unit per bulan.'],
                ['Hapus duplikat', 'Mempertahankan satu baris per kunci, mis. catatan terbaru setiap karyawan, dan mencantumkan sisanya di Kualitas data.'],
                ['Tujuan', 'Menulis ke dataset atau ke sumber data tujuan seperti produk KMPlus.'],
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
                '**Tambahkan setelah langkah terpilih** di kiri menyisipkan langkah Filter, Pemetaan & transformasi, Validasi, Aturan bisnis, Router, Gabung, Satukan, Agregasi, Hapus duplikat, atau Tujuan; **Sumber** menambahkan sumber lain untuk digabungkan.',
                'Pilih langkah untuk mengeditnya di kanan; **Langkah berikutnya** menghubungkannya ke langkah selanjutnya (Router punya satu per cabang).',
                '**Pengaturan eksekusi** mengatur pengulangan, batas waktu, ukuran batch, ambang karantina, dan kapan memberi peringatan (tidak pernah, saat gagal, atau saat gagal atau ada baris tertahan).',
                '**Jadwal** mengatur kapan versi terbit berjalan (lihat Jadwal dan pemicu).',
              ],
            },
          ],
        },
        {
          id: 'lanes',
          title: 'Beberapa sumber: Gabung dan Satukan',
          blocks: [
            { kind: 'p', text: 'Data klien jarang berada di satu tempat: ID dan nama di HRIS, gaji di API payroll, unit di tabel organisasi. Tambahkan langkah **Sumber** untuk masing-masing. Setiap sumber memulai **jalur**-nya sendiri (sumber dan langkah yang dilalui barisnya), dan jalur bertemu di langkah **Gabung** atau **Satukan**. Paling banyak 10 sumber per pipeline.' },
            {
              kind: 'list',
              items: [
                '**Penggerak**: jika ada beberapa sumber, tandai satu sebagai penggerak (kanvas memberinya label). Sumber ini dialirkan per potongan seperti satu sumber; maks. baris dan mode sinkronisasinya berlaku seperti biasa.',
                '**Gabung**: hubungkan baris yang dipertahankan ke sisi **kiri** dan sumber yang dicari ke sisi **kanan**. Pilih satu atau beberapa pasangan kunci (`employee_code` = `employee_code`).',
                '**Satukan**: hubungkan dua masukan atau lebih. Kolom dicocokkan berdasarkan nama, kolom yang tidak dimiliki suatu masukan dibiarkan kosong, dan kolom `_source` mencatat asal setiap baris.',
              ],
            },
            {
              kind: 'table',
              head: ['Pengaturan Gabung', 'Pilihan (bawaan lebih dulu)'],
              rows: [
                ['Jenis', 'Kiri: pertahankan semua baris kiri · Dalam: hanya baris yang berpasangan · Tanpa pasangan: hanya baris yang tidak berpasangan'],
                ['Bandingkan kunci', 'Abaikan spasi dan huruf besar/kecil (aktif) · abaikan nol di depan, sehingga `00123` = `123` (nonaktif)'],
                ['Beberapa pasangan', 'Satu baris per pasangan (kunci yang muncul dua kali di kanan menulis baris itu dua kali) · Pasangan pertama menurut suatu kolom'],
                ['Baris tanpa pasangan', 'Pertahankan dengan kolom kanan kosong · Buang · Karantina, untuk diputar ulang setelah pasangannya ada'],
                ['Nama kolom yang bentrok', 'Kolom kanan yang namanya sudah ada di sisi kiri diberi awalan: nama tabel sumber kanan, mis. `payroll_name`, atau awalan Anda sendiri'],
              ],
            },
            { kind: 'p', text: 'Setiap eksekusi berjalan bertahap. Pertama, sisi kanan setiap langkah Gabung dibaca penuh, melalui langkahnya sendiri, ke **penyiapan eksekusi** (paling banyak 1.000.000 baris per langkah Gabung; disimpan bertahap, sehingga eksekusi yang terhenti berlanjut dari posisinya). Lalu sumber penggerak dialirkan, setiap potongan mencari kuncinya, dan masukan Satukan dialirkan setelahnya. Penyiapan dihapus saat eksekusi selesai. Log eksekusi menyebutkan berapa baris berpasangan, berapa yang berlipat, dan berapa ruang penyiapan yang dipakai.' },
            { kind: 'p', text: '**Uji pada sampel** membaca sampel dari sumber penggerak, lalu hanya baris sisi kanan dengan kunci sampel tersebut (dari database dan file; sumber lain membaca hingga 5.000 baris), sehingga langkah Gabung menampilkan “18 dari 25 berpasangan”.' },
            { kind: 'note', tone: 'warning', text: 'Penggerak inkremental dengan langkah Gabung: sumber yang dicari dibaca penuh setiap eksekusi, tetapi hanya baris yang dibaca sumber penggerak (baru atau berubah) yang digabung. Perubahan di payroll baru sampai ke seorang karyawan ketika baris karyawan itu sendiri juga berubah. Setiap sumber menyimpan posisi sinkronisasinya sendiri.' },
            { kind: 'note', tone: 'info', text: 'Baris yang ditahan di langkah Gabung atau sesudahnya diputar ulang dari langkahnya seperti biasa. Baris yang ditahan di dalam jalur yang mengisi sisi kanan langkah Gabung tidak dapat diputar ulang ke penggabungan yang sudah selesai: jalankan pipeline lagi setelah memperbaiki sumbernya.' },
          ],
        },
        {
          id: 'blocking',
          title: 'Agregasi dan Hapus duplikat',
          blocks: [
            { kind: 'p', text: 'Kedua langkah ini memerlukan semua baris sebelum dapat menjawab, sehingga eksekusi lebih dulu membaca sumbernya, menahan baris yang sampai ke langkah tersebut, lalu menjawab per kelompok dan meneruskan hasilnya ke langkah berikutnya.' },
            {
              kind: 'table',
              head: ['Langkah', 'Pengaturan'],
              rows: [
                ['Agregasi', 'Kelompokkan per kolom dan, bila perlu, rentang waktu pada kolom tanggal (hari, minggu mulai Senin, bulan, kuartal, tahun). Ukuran: jumlah baris, jumlah unik, total, rata-rata, minimum, maksimum, pertama / terakhir menurut suatu kolom, gabungkan sebagai teks, kumpulkan sebagai daftar; masing-masing dapat hanya menghitung baris yang memenuhi kondisi (mis. `active_headcount` = jumlah baris dengan status = Active).'],
                ['Hapus duplikat', 'Kolom kunci (dibandingkan dengan mengabaikan spasi dan huruf besar/kecil, seperti kunci Gabung). Pertahankan baris terbaru menurut kolom tanggal (bawaan bila ada), yang pertama dibaca, atau yang terakhir dibaca.'],
              ],
            },
            {
              kind: 'list',
              items: [
                'Duplikat yang dihapus dicantumkan di **Kualitas data** sebagai tanda, masing-masing menyebutkan baris yang dipertahankan. Tidak ada yang ditahan; tanda tidak membuat eksekusi menjadi sebagian.',
                'Langkah Agregasi memerlukan **pembacaan penuh** dari sumber yang mengisinya: pembacaan inkremental hanya akan menghitung baris yang berubah, sehingga editor menolaknya.',
                'Baris yang ditahan sebelumnya di jalur itu (gagal pemeriksaan) tidak dihitung; log eksekusi menyebutkan jumlahnya. Perbaiki lalu jalankan pipeline lagi, bukan diputar ulang.',
                'Langkah Agregasi juga dapat menyiapkan sisi yang dicari pada langkah Gabung, mis. menjumlahkan tunjangan per karyawan lalu menggabungkannya ke setiap karyawan.',
                '**Uji pada sampel** mengagregasi sampelnya saja; hasil uji menyebutkannya.',
              ],
            },
          ],
        },
        {
          id: 'mapping',
          title: 'Pemetaan dan transformasi',
          blocks: [
            { kind: 'p', text: 'Langkah **Pemetaan & transformasi** menampilkan setiap kolom keluaran beserta kolom sumber dan tipenya. **Petakan otomatis** mencocokkan sinonim SDM (mis. `PERNR`, `NIK`, `employee_no`) ke nama baku Unified Data Model, dan templat pemetaan yang tersimpan (bawaan untuk SAP, Talenta, dan Active Directory) mengisi satu langkah sekaligus.' },
            {
              kind: 'table',
              head: ['Jenis', 'Transformasi'],
              rows: [
                ['Teks', 'rapikan spasi, huruf besar / kecil / judul, ganti, ganti dan ambil regex, awalan, akhiran, substring, gabung, pisah'],
                ['Nilai', 'bawaan jika kosong, coalesce, bersyarat (jika … maka … selain itu)'],
                ['Angka & tanggal', 'ke angka, bulatkan, format angka, format tanggal (dengan format masukan dan zona waktu), ke boolean'],
                ['Privasi', 'hash (pseudonim tetap)'],
                ['Lookup', 'cari nilai di dataset lain, mis. `ORG_CODE` → nama organisasi'],
              ],
            },
          ],
        },
        {
          id: 'checks',
          title: 'Pemeriksaan validasi',
          blocks: [
            { kind: 'p', text: 'Langkah **Validasi** menjalankan pemeriksaan pada setiap baris. Setiap pemeriksaan punya tingkat: **error** menahan baris di karantina, **peringatan** dan **info** hanya mencatatnya pada eksekusi.' },
            {
              kind: 'list',
              items: [
                '**Format**: wajib, email, telepon, NIK, NPWP, regex, panjang minimum dan maksimum, salah satu dari daftar.',
                '**Nilai dan tanggal**: minimum, maksimum, tanggal valid, tidak di masa depan, bandingkan dua field (tanggal selesai setelah tanggal mulai).',
                '**Lintas baris dan dataset**: unik, ada di dataset lain, hierarki manajer (setiap manajer ada, tanpa putaran).',
                '**Kondisi**: kondisi apa pun yang disusun dengan penyusun aturan.',
              ],
            },
            { kind: 'p', text: 'Templat HRIS → Employee menambahkan **paket aturan SDM** berisi pemeriksaan ini untuk kolom yang ditemukannya.' },
          ],
        },
        {
          id: 'writing',
          title: 'Tujuan dan mode tulis',
          blocks: [
            {
              kind: 'table',
              head: ['Mode', 'Yang terjadi'],
              rows: [
                ['Ganti', 'Dataset dibangun ulang dari eksekusi ini; pembaca melihat baris lama sampai baris baru lengkap.'],
                ['Tambah', 'Baris ditambahkan. Potongan yang dilanjutkan atau diulang menggantikan salinannya sendiri, jadi tidak ada yang ditulis dua kali.'],
                ['Upsert', 'Baris dicocokkan pada kolom kunci lalu diperbarui atau disisipkan. **Tandai baris yang tidak ada lagi di sumber sebagai terhapus** menghapus-lunak orang yang sudah keluar (memerlukan pembacaan penuh, bukan inkremental).'],
              ],
            },
            { kind: 'p', text: 'Satu pipeline bisa punya beberapa tujuan, mis. dataset employees dan sebuah produk KMPlus.' },
            { kind: 'p', text: '**Mengirim baris ke REST API.** Pilih sumber data REST di langkah Tujuan, lalu atur metode (POST, PUT, atau PATCH) dan path. `{{column}}` di path diisi nilai setiap baris, mis. `PUT /employees/{{employee_id}}`.' },
            {
              kind: 'steps',
              items: [
                '**Sunting body** lalu tempel contoh body yang diharapkan API, dalam JSON, form-encoded (`nama=nilai&…`), atau XML.',
                '**Baca contoh** mengubahnya menjadi daftar nilai (`employee.name`, `contacts[].email`, …) dan mencocokkannya dengan kolom berdasarkan nama dan sinonim HR. Isi setiap nilai dengan kolom, nilai tetap, perhitungan, atau informasi eksekusi (id eksekusi, id batch, jumlah baris dalam permintaan, waktu kirim); tandai nilai yang wajib dan pilih apa yang terjadi pada nilai kosong.',
                'Untuk mengirim beberapa baris dalam satu permintaan, pilih daftar yang memuat baris di **Baris per permintaan** (daftar tingkat atas dipilih otomatis; di XML, pilih elemen yang diulang). Jika tidak, setiap baris menjadi satu permintaan.',
                'Jalankan **Uji pada sampel**, lalu **Pratinjau permintaan** (uji kering, tidak mengirim apa pun) atau **Kirim permintaan uji**, yang mengirim baris pertama ke API sungguhan dan menampilkan permintaan, dengan proses masuk disamarkan, serta jawabannya.',
              ],
            },
            {
              kind: 'table',
              head: ['Jawaban API', 'Yang dilakukan Nexus'],
              rows: [
                ['2xx', 'Tertulis. Jika jawaban mencantumkan item yang ditolak (atur path daftarnya di **Item yang ditolak dalam jawaban 2xx**), hanya baris tersebut yang masuk ke Kualitas data dengan pesan dari API.'],
                ['4xx lainnya', 'Baris tersebut masuk ke Kualitas data dengan status dan alasan singkat (email dan angka panjang disamarkan). Perbaiki lalu putar ulang dari langkah tujuan.'],
                ['408, 429, 5xx, atau tidak ada jawaban', 'Diulang hingga 4 kali dengan jeda yang makin panjang, mematuhi Retry-After; setelah itu eksekusi diulang dari checkpoint terakhir.'],
                ['401 atau 403, pengalihan, atau 404 untuk setiap permintaan', 'Eksekusi berhenti: proses masuk, URL dasar, atau path perlu diperbaiki.'],
              ],
            },
            { kind: 'note', tone: 'warning', text: 'API tidak dapat memberi jaminan tepat-sekali seperti dataset. Saat eksekusi diulang, baris yang sudah terkirim dapat terkirim lagi: POST lalu menimbulkan duplikat. Utamakan PUT atau PATCH ke path dengan kunci record, atau aktifkan **Kirim kunci idempotensi** (kunci tetap eksekusi:chunk:batch) jika API mendukungnya. Baris per permintaan, maks. permintaan per detik (bawaan 10), permintaan paralel (1–4), dan batas waktu diatur di langkah ini; Nexus menjaga chunk cukup kecil agar selesai pada kecepatan tersebut.' },
            { kind: 'p', text: 'Langkah ini memberi peringatan jika body mengirim kolom yang diklasifikasikan pribadi atau sensitif di Tata kelola. Body permintaan tidak pernah dicatat di log.' },
          ],
        },
        {
          id: 'publish',
          title: 'Uji, simpan, terbitkan, dan versi',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Uji pada sampel** membaca baris nyata, menjalankan setiap langkah, dan tidak menulis apa pun. Setiap langkah lalu menampilkan berapa baris yang lolos, berubah, atau ditahan; pilih langkah untuk melihat barisnya (disamarkan sesuai peran Anda).',
                '**Simpan draf** menyimpan perubahan Anda; versi **terbit** tetap berjalan sampai Anda **Simpan & publikasikan**.',
                'Setiap penerbitan adalah versi dengan catatan perubahan opsional. Riwayat versi bisa **memulihkan** versi sebelumnya: versi itu menjadi versi yang berjalan (setelah disetujui, jika workspace Anda mewajibkannya).',
                'Saat eksekusi gagal, **Diagnosis dengan AI** menjelaskan kegagalan dari pesan langkah (tidak pernah nilai baris) dan bisa menyarankan perbaikan sebagai draf baru.',
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
          title: 'Persetujuan penerbitan',
          blocks: [
            { kind: 'p', text: 'Workspace bisa mewajibkan **orang kedua** menyetujui suatu versi sebelum berjalan. Atur di **Pengaturan → Persetujuan & lingkungan**:' },
            {
              kind: 'table',
              head: ['Pengaturan', 'Yang menunggu persetujuan'],
              rows: [
                ['Nonaktif', 'Tidak ada: editor menerbitkan langsung.'],
                ['Perubahan destruktif', 'Versi yang mengganti dataset atau menandai baris terhapus.'],
                ['Setiap penerbitan', 'Setiap versi, termasuk promosi ke workspace ini.'],
              ],
            },
            { kind: 'p', text: 'Versi yang menunggu tampil di **Riwayat persetujuan** pada layar Pipeline dan di **Perlu Anda tangani** pada Ringkasan. Admin atau data steward menyetujui atau menolaknya; tidak ada yang menyetujui perubahannya sendiri, jadi persetujuan memerlukan setidaknya dua admin atau steward.' },
          ],
        },
        {
          id: 'environments',
          title: 'Lingkungan: Development, Staging, Production, dan promosi',
          blocks: [
            { kind: 'p', text: 'Bangun dan uji pipeline dengan aman sebelum menyentuh data produksi. **Grup lingkungan** menghubungkan hingga tiga workspace sebagai **Development → Staging → Production**. Masing-masing memiliki **anggota, sumber data, dan kredensialnya sendiri**, sehingga Development bisa membaca database SDM uji sementara Production membaca yang asli, dengan pipeline yang sama.' },
            { kind: 'diagram', diagram: 'environments', caption: 'Jalur promosi. Pipeline dibangun di Development lalu maju satu lingkungan demi satu lingkungan; Production hanya berubah lewat promosi.' },
            { kind: 'shot', screen: 'environments', caption: 'Pengaturan → Persetujuan & lingkungan: workspace yang terhubung, mana yang terkunci, dan ke mana pipeline dipromosikan.' },
            {
              kind: 'steps',
              items: [
                '**Siapkan**: di workspace Development buka **Pengaturan → Persetujuan & lingkungan → Siapkan lingkungan**, tentukan tahap workspace ini, lalu buat tahap yang belum ada (Anda menjadi adminnya). Atau **Tautkan ruang kerja** yang sudah Anda kelola sebagai salah satu tahap.',
                '**Siapkan setiap lingkungan**: tambahkan sumber data yang sama **namanya** di Staging dan Production (mis. “Database SDM”), masing-masing dengan koneksi dan kredensialnya sendiri. Undang orang yang bekerja di sana.',
                '**Bangun dan terbitkan di Development**, uji dengan sampel dan eksekusinya.',
                '**Promosikan**: di layar Pipeline buka menu pipeline → **Promosikan ke Staging**. Pratinjau menampilkan apa saja yang dipetakan oleh promosi.',
                'Periksa hasilnya di Staging, lalu promosikan dari Staging ke **Production** dengan cara yang sama.',
              ],
            },
            {
              kind: 'table',
              head: ['Promosi memetakan', 'Caranya'],
              rows: [
                ['Sumber data', 'Berdasarkan nama dan jenis konektor: pipeline memakai sumber dan kredensial milik lingkungan tujuan. Sumber yang belum ada memblokir promosi sampai Anda menambahkannya di sana.'],
                ['Aturan bisnis', 'Berdasarkan nama: dibuat di tujuan, atau diperbarui ke versi yang dipromosikan.'],
                ['Pipeline berantai', 'Referensi “jalankan setelah” dan “picu pipeline” mengikuti pipeline yang sama di tujuan, jadi promosikan pipeline itu terlebih dahulu.'],
                ['Dataset', 'Berdasarkan nama; tidak ada yang perlu dipetakan.'],
              ],
            },
            {
              kind: 'list',
              items: [
                'Promosi menyalin versi **terbit**, jadi terbitkan dulu. Pipeline baru dibuat di tujuan dengan **jadwal nonaktif** sampai seseorang mengaktifkannya; pipeline yang sudah ada diperbarui ke versi baru.',
                'Jika tujuan mewajibkan persetujuan, versi yang dipromosikan **menunggu di sana** untuk orang kedua sebelum berjalan.',
                '**Production terkunci sejak awal**: pipeline di sana tidak bisa diedit langsung, hanya menerima promosi. Eksekusi, jadwal, dan persetujuan berjalan seperti biasa. Admin bisa membuka kuncinya (dan menguncinya lagi).',
                'Setiap baris pipeline menampilkan versinya di lingkungan berikutnya (mis. `STAGING: v3` atau `belum dipromosikan`).',
                'Anda harus menjadi admin atau data steward di lingkungan tujuan untuk mempromosikan ke sana. Setiap promosi dicatat di log audit.',
              ],
            },
          ],
        },
      ],
    },
    // ── 4 ───────────────────────────────────────────────────────────────────
    {
      id: 'rules',
      title: 'Aturan bisnis',
      summary: 'Pemeriksaan dan keputusan yang ditulis sekali dan dipakai ulang di banyak pipeline.',
      screen: 'rules',
      sections: [
        {
          id: 'rules-what',
          title: 'Aturan dalam praktik',
          blocks: [
            { kind: 'shot', screen: 'rules', caption: 'Aturan bisnis beserta tempat masing-masing dipakai.' },
            { kind: 'p', text: 'Aturan berbunyi **JIKA** suatu kondisi **MAKA** lakukan sesuatu, **SELAIN ITU** lakukan hal lain. Aturan dipakai bersama: ubah aturan sekali dan setiap pipeline yang memakainya menerapkan versi baru pada eksekusi berikutnya. Langkah Filter, Validasi, Router, dan Aturan bisnis semuanya bisa memakainya.' },
          ],
        },
        {
          id: 'conditions',
          title: 'Kondisi dan ekspresi',
          blocks: [
            { kind: 'p', text: 'Kondisi menggabungkan perbandingan field dengan **semua** / **salah satu** dan grup bersarang. Nilai bisa berupa nilai tetap, field lain, atau ekspresi seperti `days_between(start_date, today())`, `upper(name)`, atau `year(hire_date)`.' },
          ],
        },
        {
          id: 'actions',
          title: 'Yang bisa dilakukan aturan',
          blocks: [
            {
              kind: 'table',
              head: ['Tindakan', 'Efek'],
              rows: [
                ['Sertakan / kecualikan', 'Pertahankan baris atau buang dari eksekusi ini.'],
                ['Isi field / hitung', 'Tulis nilai atau ekspresi ke sebuah kolom.'],
                ['Arahkan', 'Kirim baris ke cabang bernama pada langkah Router.'],
                ['Beri tahu', 'Email admin dan steward, atau alamat yang Anda cantumkan (sekali per eksekusi).'],
                ['Wajibkan persetujuan', 'Tahan baris di karantina sampai orang kedua menyetujuinya.'],
                ['Picu pipeline', 'Antrekan pipeline lain setelah eksekusi ini.'],
              ],
            },
          ],
        },
        {
          id: 'test-rule',
          title: 'Uji dan versikan aturan',
          blocks: [
            { kind: 'p', text: '**Penguji** di editor aturan menjalankan aturan pada baris dari dataset atau pada JSON yang Anda tempel, dan menunjukkan cabang yang diambil setiap baris. Setiap simpanan adalah versi; perubahan dicatat di log audit.' },
          ],
        },
      ],
    },
    // ── 5 ───────────────────────────────────────────────────────────────────
    {
      id: 'monitoring',
      title: 'Pantau eksekusi',
      summary: 'Eksekusi, jadwal, worker latar belakang, peringatan, dan webhook.',
      screen: 'monitoring',
      sections: [
        {
          id: 'runs',
          title: 'Eksekusi dan worker',
          blocks: [
            { kind: 'shot', screen: 'monitoring', caption: 'Pemantauan: kesehatan worker dan penjadwal, lalu setiap eksekusi.' },
            { kind: 'p', text: 'Eksekusi berjalan di latar belakang, jadi menutup browser tidak pernah menghentikannya. Pemantauan menampilkan hasil hari ini, grafik tujuh hari, kesehatan setiap pipeline (pekerjaan yang macet ditandai), eksekusi latar belakang dengan progres langsung, dan eksekusi terbaru.' },
          ],
        },
        {
          id: 'read-run',
          title: 'Membaca eksekusi',
          blocks: [
            { kind: 'p', text: 'Buka eksekusi untuk melihat pemicu, versi, durasi, baris dibaca, ditulis, dan ditahan per langkah dan per tujuan, serta lognya. Admin juga melihat detail teknis error.' },
          ],
        },
        {
          id: 'retry',
          title: 'Batalkan, ulangi, dan lanjutkan',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Batalkan** pekerjaan yang antre atau berjalan.',
                '**Ulangi** eksekusi yang sudah selesai. Eksekusi dilanjutkan dari checkpoint terakhir alih-alih mulai dari awal.',
                'Masalah sementara (batas waktu jaringan) diulang otomatis; masalah konfigurasi (kata sandi salah, tabel tidak ada) tidak, jadi perbaiki lalu jalankan lagi.',
                'Watermark inkremental hanya bergeser setelah seluruh eksekusi berhasil, jadi eksekusi yang gagal tidak pernah melewatkan baris.',
              ],
            },
          ],
        },
        {
          id: 'alerts',
          title: 'Peringatan dan notifikasi',
          blocks: [
            { kind: 'p', text: 'Eksekusi yang gagal membuat notifikasi di lonceng dan email ke orang yang perlu tahu; pipeline juga bisa memberi peringatan untuk baris tertahan (Pengaturan eksekusi). Peringatan tidak pernah menggagalkan eksekusi. Untuk sistem lain, gunakan webhook (lihat Data API dan webhook).' },
          ],
        },
      ],
    },
    // ── 6 ───────────────────────────────────────────────────────────────────
    {
      id: 'quality',
      title: 'Kualitas data',
      summary: 'Kotak masuk karantina: perbaiki, setujui, abaikan, dan kirim ulang baris tertahan; skor kualitas dari waktu ke waktu.',
      screen: 'quality',
      sections: [
        {
          id: 'inbox',
          title: 'Kotak masuk karantina',
          blocks: [
            { kind: 'shot', screen: 'quality', caption: 'Baris tertahan dengan masalahnya, barisnya, dan langkah pipeline yang menahannya.' },
            { kind: 'p', text: 'Setiap baris tertahan menampilkan masalahnya dalam kata-kata, barisnya (field yang gagal disorot), serta pipeline dan langkah yang menahannya. Saring berdasarkan **Perlu tindakan**, **Gagal pemeriksaan**, **Perlu persetujuan**, **Ditandai**, atau **Diperbaiki, belum dikirim ulang**, dan berdasarkan pipeline.' },
          ],
        },
        {
          id: 'why-held',
          title: 'Mengapa baris ditahan',
          blocks: [
            {
              kind: 'table',
              head: ['Jenis', 'Arti'],
              rows: [
                ['Gagal pemeriksaan', 'Error validasi, atau produk KMPlus menolak catatan. Perbaiki nilainya.'],
                ['Perlu persetujuan', 'Aturan bisnis meminta orang kedua mengonfirmasi baris. Setujui atau abaikan.'],
                ['Ditandai', 'Peringatan yang perlu dilihat; baris tetap ditulis.'],
              ],
            },
          ],
        },
        {
          id: 'fix',
          title: 'Perbaiki, setujui, abaikan, dan kirim ulang',
          blocks: [
            {
              kind: 'steps',
              items: [
                '**Perbaiki** baris: ubah nilai yang gagal, lalu **Simpan & kirim ulang** (atau perbaiki-dan-lanjut untuk menyelesaikan daftar). Beberapa baris dengan masalah yang sama bisa diperbaiki sekaligus.',
                '**Setujui** baris yang menunggu persetujuan, atau **Abaikan** baris yang tidak boleh diteruskan (bisa dibatalkan).',
                'Pengiriman ulang mengirim baris lewat pipeline **terbit** dari langkah yang menahannya, sehingga baris tetap melewati setiap pemeriksaan berikutnya.',
              ],
            },
            { kind: 'p', text: 'Eksekusi penuh yang lebih baru menggantikan baris terbuka lama dari pipeline yang sama; perbaikan dan persetujuan Anda terbawa ke baris yang identik. Nilai tersamar tidak bisa diedit oleh peran yang melihatnya tersamar.' },
          ],
        },
        {
          id: 'scores',
          title: 'Skor dan tren kualitas',
          blocks: [
            { kind: 'p', text: 'Setiap pipeline punya skor kualitas, dan setiap dataset mencatat kelengkapan, keunikan, dan validitasnya setiap hari, dengan tren 30 hari di katalog.' },
          ],
        },
      ],
    },
    // ── 7 ───────────────────────────────────────────────────────────────────
    {
      id: 'catalog',
      title: 'Katalog dan lineage',
      summary: 'Temukan dataset atau tabel sumber apa pun, dokumentasikan, lihat asalnya, dan kueri sumber secara langsung.',
      screen: 'catalog',
      sections: [
        {
          id: 'find',
          title: 'Menemukan data',
          blocks: [
            { kind: 'shot', screen: 'catalog', caption: 'Katalog: dataset dan tabel sumber beserta pemilik, tag, dan dokumentasinya.' },
            { kind: 'p', text: 'Setiap dataset dan tabel sumber muncul otomatis. **Cari dengan kata-kata biasa**: “karyawan yang bergabung bulan lalu” menemukan tabel berdasarkan nama, dokumentasi, dan nama kolom, dalam bahasa Inggris atau Indonesia (tidak pernah berdasarkan nilai baris).' },
          ],
        },
        {
          id: 'document',
          title: 'Mendokumentasikan dataset',
          blocks: [
            { kind: 'p', text: 'Steward menambahkan pemilik, steward, klasifikasi, tag, deskripsi, dan deskripsi kolom. Setiap item juga menampilkan kesegaran, riwayat kualitas, serta sampel yang tersamar dan tersaring barisnya. Dataset bisa diterbitkan sebagai entitas Unified Data Model (Employee, Organization, Position …) untuk Data API.' },
          ],
        },
        {
          id: 'lineage',
          title: 'Lineage',
          blocks: [
            { kind: 'p', text: '**Grafik lineage** menggambar pipeline mana yang membaca dan menulis setiap dataset, mundur sampai tabel sumber dan maju sampai tujuan, sehingga Anda bisa melihat apa yang terdampak suatu perubahan.' },
          ],
        },
        {
          id: 'live',
          title: 'Tabel sumber langsung atau cache',
          blocks: [
            { kind: 'p', text: 'Tabel sumber bisa dikueri **langsung** (hanya-baca, dengan batas baris dan batas waktu, filter didorong ke sumber) atau di-**cache**: Nexus menyimpan salinan lewat pipeline terkelola setiap 5 menit hingga harian, setelah pipeline lain, atau manual.' },
          ],
        },
      ],
    },
    // ── 8 ───────────────────────────────────────────────────────────────────
    {
      id: 'governance',
      title: 'Tata kelola dan privasi',
      summary: 'Klasifikasi, penyamaran, filter baris, retensi, penghapusan (UU PDP), dan jejak audit.',
      screen: 'governance',
      sections: [
        {
          id: 'controls',
          title: 'Ringkasan kontrol',
          blocks: [
            { kind: 'shot', screen: 'governance', caption: 'Tata kelola: ringkasan kontrol, lalu kebijakan dataset dengan kolom yang diklasifikasikan dan disamarkan.' },
            { kind: 'p', text: 'Bagian atas layar Tata kelola memeriksa workspace sekilas: autentikasi dua faktor, kredensial terenkripsi, jejak audit, dataset dengan kebijakan, retensi, dan peran yang ditegakkan server. Apa pun yang perlu perhatian dinyatakan dengan tanda dan kata-kata.' },
          ],
        },
        {
          id: 'masking',
          title: 'Klasifikasi dan penyamaran',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Klasifikasikan** setiap kolom sebagai publik, internal, pribadi, atau sensitif. Nexus menyarankan kelas dan penyamaran untuk kolom SDM umum seperti NIK, NPWP, gaji, dan telepon; saran baru berlaku setelah kebijakan disimpan.',
                '**Samarkan** kolom untuk peran tanpa akses tak tersamar: sembunyikan nilainya, sisakan empat karakter terakhir (`••••0001`), atau ganti dengan pseudonim tetap (hash) agar hitungan dan penggabungan tetap cocok.',
                '**Pratinjau sebagai analis** menampilkan dataset seperti yang dilihat peran terbatas.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Penyamaran dan filter baris berlaku di mana pun data ditampilkan: pratinjau dataset, katalog, Analitik, jawaban AI, dan Data API. Admin dan data steward melihat nilai sebenarnya.' },
          ],
        },
        {
          id: 'row-filters',
          title: 'Filter baris per peran',
          blocks: [
            { kind: 'p', text: 'Filter baris membatasi baris yang dilihat suatu peran, mis. viewer hanya melihat `business_unit = Retail`. Filter memakai sama dengan, tidak sama dengan, atau daftar nilai, dan berlaku di tempat yang sama dengan penyamaran.' },
          ],
        },
        {
          id: 'retention',
          title: 'Retensi dan penghapusan (UU PDP)',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Retensi** menghapus baris yang lebih tua dari jangka waktu yang Anda tetapkan per dataset; diperiksa setiap jam.',
                '**Hak penghapusan** (admin) menemukan catatan satu orang di setiap dataset berdasarkan kolom pencocok dan nilai persis (mis. `employee_id = E00123`), menampilkan jumlah baris yang cocok, lalu menghapusnya setelah Anda konfirmasi. Hapus juga orang itu dari sistem sumber, atau eksekusi berikutnya membawanya kembali. Penghapusan dicatat di log audit.',
              ],
            },
          ],
        },
        {
          id: 'audit',
          title: 'Jejak audit',
          blocks: [
            { kind: 'p', text: '**Pengaturan → Log audit** menampilkan proses masuk, setiap perubahan (dengan nilai sebelum dan sesudah), dan setiap tampilan data asli, beserta orang, waktu, alamat IP, dan browser. Rahasia hanya dicatat sebagai “diubah”.' },
          ],
        },
      ],
    },
    // ── 9 ───────────────────────────────────────────────────────────────────
    {
      id: 'analytics',
      title: 'Analitik',
      summary: 'Dasbor dan pertanyaan berbahasa biasa atas dataset Anda.',
      screen: 'analytics',
      sections: [
        {
          id: 'dashboards',
          title: 'Dasbor',
          blocks: [
            { kind: 'shot', screen: 'analytics', caption: 'Analitik: dasbor yang dibangun dari dataset.' },
            { kind: 'p', text: 'Dasbor adalah kumpulan widget: angka, grafik batang atau garis, atau tabel, masing-masing atas satu dataset. Setiap grafik punya tampilan tabel, dan setiap widget menunjukkan seberapa segar datanya.' },
          ],
        },
        {
          id: 'widget',
          title: 'Membangun widget',
          blocks: [
            {
              kind: 'steps',
              items: [
                'Pilih dataset dan jenis widget.',
                'Pilih **ukuran** (jumlah, jumlah unik, total, rata-rata, minimum, maksimum) dan **kelompokkan menurut**, dengan rentang waktu untuk tanggal (hari, minggu, bulan, kuartal, tahun).',
                'Tambahkan filter, urutan, dan batas; pratinjau diperbarui seiring Anda bekerja. Simpan dasbor.',
              ],
            },
          ],
        },
        {
          id: 'ask',
          title: 'Bertanya dengan kata-kata',
          blocks: [
            { kind: 'p', text: '**Ajukan pertanyaan** (“jumlah karyawan per departemen tahun ini”) dan asisten AI menyusun draf widget dari kolom dataset yang sebenarnya. Anda bisa menyimpan, mengubah, atau membuangnya.' },
          ],
        },
        {
          id: 'readers',
          title: 'Yang dilihat pembaca',
          blocks: [
            { kind: 'p', text: 'Kueri hanya-baca dan berhenti setelah 15 detik. Setiap pembaca melihat dasbor lewat perannya sendiri: kolom tersamar tidak bisa dikelompokkan atau disaring, dan filter baris berlaku untuk setiap angka.' },
          ],
        },
      ],
    },
    // ── 10 ──────────────────────────────────────────────────────────────────
    {
      id: 'api',
      title: 'Data API dan webhook',
      summary: 'Baca dataset dari sistem lain, jalankan pipeline dari jarak jauh, dan dapatkan kabar saat sesuatu terjadi.',
      screen: 'settings',
      sections: [
        {
          id: 'keys',
          title: 'Kunci API dan cakupan',
          blocks: [
            { kind: 'p', text: 'Buat kunci di **Pengaturan → Kunci API** dengan cakupan yang diperlukan, sebuah peran, dan masa berlaku opsional. Kunci membaca sebagai peran itu, dengan penyamaran dan filter barisnya. Kunci ditampilkan sekali; Nexus hanya menyimpan hash-nya, dan Anda bisa mencabutnya kapan saja.' },
            {
              kind: 'table',
              head: ['Cakupan', 'Mengizinkan'],
              rows: [
                ['`datasets:read`', 'Membaca dataset dan tabel katalog langsung.'],
                ['`domains:read`', 'Membaca entitas Unified Data Model (Employee, Organization …).'],
                ['`pipelines:run`', 'Memulai eksekusi pipeline.'],
                ['`runs:read`', 'Membaca status dan hasil eksekusi.'],
              ],
            },
          ],
        },
        {
          id: 'read',
          title: 'Membaca data',
          blocks: [
            { kind: 'code', text: 'curl -H "Authorization: Bearer nxk_…" "https://<nexus-anda>/api/v1/datasets/employees?fields=nik,full_name&limit=100"' },
            { kind: 'p', text: 'Respons dipaginasi dengan kursor, bisa disaring per field dan `updated_since`, serta membawa header batas laju. Setiap pembacaan dicatat di log audit. Referensi lengkap ada di `/api/v1/openapi.json`.' },
          ],
        },
        {
          id: 'remote-run',
          title: 'Menjalankan pipeline dari sistem lain',
          blocks: [
            { kind: 'p', text: '`POST /api/v1/pipelines/{id}/runs` memulai eksekusi; `GET /api/v1/runs/{id}` mengikutinya. Pipeline juga bisa dimulai lewat URL webhook rahasianya sendiri, yang diatur di tab Jadwal pada editor.' },
          ],
        },
        {
          id: 'webhooks',
          title: 'Webhook keluar',
          blocks: [
            { kind: 'p', text: '**Pengaturan → Webhook** mengirim peristiwa bertanda tangan (`run.succeeded`, `run.failed`, `dataset.updated`) ke endpoint HTTPS Anda. Verifikasi tanda tangan dengan rahasia penandatanganan; pengiriman yang gagal diulang.' },
          ],
        },
      ],
    },
    // ── 11 ──────────────────────────────────────────────────────────────────
    {
      id: 'admin',
      title: 'Kelola workspace',
      summary: 'Peran, anggota dan undangan, masuk dan SSO, pengaturan, serta asisten AI.',
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
          id: 'members',
          title: 'Anggota dan undangan',
          blocks: [
            { kind: 'p', text: '**Pengaturan → Anggota & peran**: undang orang lewat email (mereka menerima tautan), ubah peran, dan keluarkan anggota. Setiap orang mulai dengan workspace pribadi; admin terakhir tidak bisa meninggalkan workspace.' },
          ],
        },
        {
          id: 'sso',
          title: 'Masuk, SSO, dan SCIM',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Single sign-on** dengan OIDC atau SAML 2.0 (Microsoft Entra ID, Google, Okta, dan lainnya). Verifikasi domain email Anda dengan catatan DNS TXT; orang di domain itu lalu bergabung ke workspace ini dengan peran bawaan saat pertama masuk.',
                '**Wajibkan SSO** memblokir masuk dengan kata sandi untuk domain itu.',
                '**SCIM** memungkinkan penyedia identitas Anda membuat akun dan menonaktifkannya saat SDM memberhentikan seseorang; grup yang dipetakan ke peran mengatur peran anggotanya.',
              ],
            },
          ],
        },
        {
          id: 'settings-tabs',
          title: 'Sekilas pengaturan',
          blocks: [
            { kind: 'shot', screen: 'settings', caption: 'Pengaturan, dengan satu tab per area.' },
            {
              kind: 'table',
              head: ['Tab', 'Yang Anda kelola'],
              rows: [
                ['Umum', 'Nama workspace.'],
                ['Anggota & peran', 'Undang orang, ubah peran, keluarkan anggota.'],
                ['Akun Anda', 'Autentikasi dua faktor dan kode cadangan Anda sendiri.'],
                ['Masuk, SSO & SCIM', 'Single sign-on dengan domain terverifikasi, dan provisioning SCIM.'],
                ['Persetujuan & lingkungan', 'Apakah penerbitan perlu orang kedua; Development, Staging, dan Production; penguncian.'],
                ['Nexus Agent', 'Agent di jaringan Anda dan statusnya.'],
                ['Asisten AI', 'Model open-source yang dipakai asisten: milik server, yang berjalan di dekat agent, atau nonaktif.'],
                ['Kunci API · Webhook', 'Kunci Data API dan webhook keluar.'],
                ['Log audit', 'Setiap perubahan dan setiap tampilan data asli, dengan siapa, kapan, dan dari mana.'],
              ],
            },
          ],
        },
        {
          id: 'ai',
          title: 'Asisten AI',
          blocks: [
            { kind: 'p', text: 'Asisten menyusun draf pipeline, menjelaskan eksekusi yang gagal, menyarankan konektor, mencari di katalog, dan menjawab pertanyaan di Analitik. Asisten **hanya memakai model open-source**, lewat model milik server atau model yang berjalan di dekat Nexus Agent Anda, sehingga prompt bisa tetap di dalam jaringan Anda. Admin memilih model atau menonaktifkannya; semua fitur lain tetap berjalan tanpanya.' },
          ],
        },
      ],
    },
    // ── 12 ──────────────────────────────────────────────────────────────────
    {
      id: 'security',
      title: 'Keamanan',
      summary: 'Cara Nexus melindungi akun, kredensial, jaringan, dan data.',
      sections: [
        {
          id: 'accounts',
          title: 'Akun dan autentikasi dua faktor',
          blocks: [
            { kind: 'p', text: '**Setiap akun memakai autentikasi dua faktor** (aplikasi autentikator, dengan sepuluh kode cadangan), kecuali masuk lewat SSO perusahaan Anda. Ponsel hilang? Masuk dengan kode cadangan lalu atur ponsel baru di **Pengaturan → Akun Anda**; admin juga bisa mengatur ulangnya untuk Anda.' },
          ],
        },
        {
          id: 'credentials',
          title: 'Kredensial dan enkripsi',
          blocks: [
            { kind: 'p', text: 'Kredensial dienkripsi dengan AES-256-GCM memakai kunci yang diturunkan untuk workspace Anda, tidak pernah dikembalikan ke browser, dan tidak pernah ditulis ke log. Jauhkan sama sekali dari Nexus dengan pengelola rahasia atau Nexus Agent.' },
          ],
        },
        {
          id: 'network',
          title: 'Keamanan jaringan',
          blocks: [
            { kind: 'p', text: 'Permintaan konektor dari cloud menolak alamat privat dan intranet serta memeriksa setiap pengalihan; webhook dan penemuan SSO hanya menerima HTTPS publik. Agent hanya pernah terhubung keluar.' },
          ],
        },
        {
          id: 'ai-data',
          title: 'AI dan data Anda',
          blocks: [
            { kind: 'p', text: 'Prompt hanya membawa nama tabel dan kolom serta contoh dari kolom publik; kolom pribadi dan tersamar tidak disertakan, dan pesan pemeriksaan disamarkan. Jawaban AI selalu berupa draf yang Anda tinjau. Pemakaian asisten diaudit tanpa teks prompt.' },
          ],
        },
      ],
    },
  ],
  faqGroups: [
    { id: 'basics', title: 'Dasar' },
    { id: 'connecting', title: 'Menghubungkan sistem' },
    { id: 'pipelines', title: 'Pipeline dan eksekusi' },
    { id: 'environments', title: 'Lingkungan dan promosi' },
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
    { id: 'chain', group: 'pipelines', q: 'Bagaimana menjalankan pipeline B setelah pipeline A?', a: 'Di jadwal B pilih **Setelah pipeline lain** dan pilih A. B diantrekan setiap kali A selesai.' },
    { id: 'join-multiplied', group: 'pipelines', q: 'Mengapa dataset saya memiliki lebih banyak baris daripada sistem HR setelah langkah Gabung?', a: 'Langkah Gabung menulis **satu baris per pasangan**: karyawan dengan dua catatan payroll menjadi dua baris. Uji dan log eksekusi menyebutkan berapa baris yang berlipat. Untuk mempertahankan satu, setel **Beberapa pasangan** ke *Hanya pasangan pertama* dan pilih kolom penentunya (mis. `valid_from` terbaru).' },
    { id: 'join-no-match', group: 'pipelines', q: 'Baris ditahan di langkah Gabung dengan “Tidak ada pasangan di …”. Lalu bagaimana?', a: 'Kuncinya tidak ditemukan di sisi kanan langkah Gabung (sering kali unit atau catatan yang dibuat belakangan, atau kunci yang ditulis berbeda). Periksa cara membandingkan kunci, atau tunggu hingga pasangannya ada; lalu buka baris itu di Kualitas data dan pilih **Simpan & putar ulang**: baris masuk kembali di langkah Gabung dan dicocokkan lagi.' },
    { id: 'join-incremental', group: 'pipelines', q: 'Bisakah pipeline inkremental memakai langkah Gabung?', a: 'Bisa. Sumber yang dicari dibaca penuh setiap eksekusi, sehingga baris baru dari sumber penggerak selalu menemukan pasangannya. Namun perubahan yang hanya terjadi di sisi yang dicari (gaji baru) baru sampai ke seorang karyawan ketika baris karyawan itu dibaca lagi: gunakan pembacaan penuh bila hal itu penting, atau atur ulang posisi sinkronisasi.' },
    { id: 'dedupe-which', group: 'pipelines', q: 'Seorang karyawan muncul dua kali di sumber. Catatan mana yang dipertahankan?', a: 'Tambahkan langkah **Hapus duplikat** pada kunci karyawan. Secara bawaan langkah ini mempertahankan catatan terbaru menurut kolom tanggal seperti `updated_at`; Anda juga dapat mempertahankan yang pertama atau terakhir dibaca. Setiap catatan yang dihapus dicantumkan di Kualitas data, dengan menyebutkan yang dipertahankan. Duplikat antar-eksekusi ditangani oleh tujuan upsert dengan kunci yang sama.' },
    { id: 'aggregate-incremental', group: 'pipelines', q: 'Mengapa langkah Agregasi tidak bisa membaca secara inkremental?', a: 'Pembacaan inkremental hanya membawa baris baru atau yang berubah, sehingga jumlah karyawan hanya akan menghitung baris itu. Setel sumber yang mengisi langkah Agregasi ke **Penuh**; bila datanya besar, jadwalkan pipeline lebih jarang.' },
    { id: 'deleted-employees', group: 'pipelines', q: 'Bagaimana karyawan yang keluar ditangani?', a: 'Dengan tujuan upsert dan **Tandai baris yang tidak ada lagi di sumber sebagai terhapus**, baris yang hilang dari sumber ditandai terhapus alih-alih dibuang. Pembacaan mengecualikannya; riwayatnya tetap ada.' },
    { id: 'env-why', group: 'environments', q: 'Mengapa memakai Development, Staging, dan Production?', a: 'Agar pipeline bisa diubah tanpa membahayakan data produksi. Bangun dengan data uji di Development, periksa hasilnya dengan data mirip produksi di Staging, dan promosikan hanya yang berhasil ke Production, yang tidak bisa diedit langsung.' },
    { id: 'env-sources', group: 'environments', q: 'Apakah pipeline yang dipromosikan membaca database Development di Production?', a: 'Tidak. Sumber data dicocokkan **berdasarkan nama**, dan setiap lingkungan punya sumber sendiri dengan kredensialnya sendiri. Beri sumber nama yang sama di setiap lingkungan; sumber yang belum ada memblokir promosi.' },
    { id: 'env-schedule', group: 'environments', q: 'Saya sudah mempromosikan pipeline tetapi tidak berjalan di Production.', a: 'Pipeline yang baru dipromosikan dimulai dengan **jadwal nonaktif**; aktifkan di Production. Jika Production mewajibkan persetujuan, versinya juga menunggu orang kedua terlebih dahulu.' },
    { id: 'env-edit-prod', group: 'environments', q: 'Mengapa saya tidak bisa mengedit pipeline di Production?', a: 'Production **terkunci**: pipeline di sana hanya berubah lewat promosi, sehingga yang berjalan sudah diuji lebih dulu. Lakukan perubahan di Development lalu promosikan. Admin bisa membuka kunci Production di Pengaturan bila benar-benar perlu.' },
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
    environments: {
      stages: [
        { title: 'Development', body: 'Bangun dan uji dengan data uji', note: 'bisa diedit' },
        { title: 'Staging', body: 'Periksa dengan data mirip produksi', note: 'bisa diedit' },
        { title: 'Production', body: 'Data SDM asli dan produk KMPlus', note: 'terkunci: hanya berubah lewat promosi' },
      ],
      promote: 'Promosikan',
      matches: 'sumber data dan aturan dicocokkan berdasarkan nama',
      approval: 'persetujuan jika tujuan mewajibkannya',
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
