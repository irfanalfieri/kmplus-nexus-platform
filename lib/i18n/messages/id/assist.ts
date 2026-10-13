import type { Messages } from '../en'

/** Bahasa Indonesia for AI-2 and AI-3; same shape as en/assist.ts. */
export const assist: Messages['assist'] = {
  pipeline: {
    label: 'Jelaskan pipeline-nya',
    placeholder: 'mis. Sinkronkan karyawan aktif dari ekspor SAP ke dataset employees setiap hari kerja pukul 02.00',
    hint: 'Asisten merencanakannya dari sumber dan tabel Anda yang sebenarnya. Anda meninjau draf di editor sebelum apa pun disimpan.',
    action: 'Buat draf pipeline',
    working: 'Membuat draf…',
    drafted: 'Draf dari {model}. Tinjau setiap langkah sebelum menyimpan.',
  },
  diagnose: {
    action: 'Diagnosis dengan AI',
    working: 'Mendiagnosis…',
    title: 'Diagnosis',
    cause: 'Kemungkinan penyebab',
    steps: 'Yang perlu dilakukan',
    fix: 'Perbaikan yang disarankan',
    applyFix: 'Terapkan perbaikan sebagai draf',
    applyTitle: 'Simpan perbaikan ini sebagai draf baru?',
    applyBody: 'Versi terbit saat ini tetap berjalan. Tinjau draf di editor dan terbitkan bila sudah sesuai.',
    applied: 'Draf v{version} disimpan dengan perbaikan. Buka editor untuk meninjau dan menerbitkannya.',
    noFix: 'Tidak ada perbaikan otomatis: perlu perubahan di sistem sumber atau keputusan seseorang.',
    by: 'Dari {model}. Nilai pribadi disembunyikan dari model.',
    addTransform: 'Tambahkan {transform} pada langkah Map untuk {field}{args}',
    changeSeverity: 'Ubah pemeriksaan {rule} pada {field} menjadi {severity}',
    removeRule: 'Hapus pemeriksaan {rule} pada {field}',
  },
  failed: 'Asisten tidak dapat membantu',
}
