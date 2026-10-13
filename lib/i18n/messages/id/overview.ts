import type { Messages } from '../en'

/** Bahasa Indonesia for the Overview screen; same shape as en/overview.ts. */
export const overview: Messages['overview'] = {
  greeting: { morning: 'Selamat pagi, {name}', afternoon: 'Selamat siang, {name}', evening: 'Selamat malam, {name}' },
  readout: {
    label: '24 jam terakhir',
    runs: '{count} eksekusi',
    failed: '{count} gagal',
    written: '{count} baris ditulis',
    held: '{count} baris ditahan',
    datasets: '{count} dataset',
  },
  lines: {
    title: 'Alur',
    body: 'Setiap pipeline sebagai alur dari sumbernya ke tempat ia menulis. Alur yang terputus ditampilkan lebih dulu.',
    empty: 'Belum ada alur',
    emptyBody: 'Satu alur muncul di sini untuk setiap pipeline yang Anda buat.',
    openPipelines: 'Buka pipeline',
    more: '{count} lainnya di Pipeline',
  },
  needs: {
    title: 'Perlu Anda tangani',
    clear: 'Tidak ada yang perlu Anda tangani',
    clearBody: 'Semua alur aktif dan tidak ada yang ditahan.',
    held: '{count} baris ditahan oleh pemeriksaan',
    approvalRows: '{count} baris menunggu persetujuan',
    flagged: '{count} baris ditandai',
    approvals: '{count} versi pipeline menunggu persetujuan',
    failed: '{name} gagal',
    partial: '{name} menahan sebagian baris',
    source: '{name} tidak terhubung',
    review: 'Tinjau',
    open: 'Buka',
    check: 'Periksa',
  },
  next: {
    title: 'Berikutnya',
    empty: 'Belum ada yang terjadwal. Jadwalkan pipeline untuk melihat eksekusi berikutnya di sini.',
  },
  setup: {
    title: 'Siapkan ruang kerja Anda',
    progress: '{done} dari {total} selesai',
    connector: 'Pasang konektor',
    source: 'Hubungkan sumber data',
    pipeline: 'Buat pipeline',
    run: 'Jalankan sekali',
    schedule: 'Jadwalkan',
    done: 'Selesai',
    todo: 'Belum',
  },
  loadFailed: 'Tidak dapat memuat ringkasan',
}
