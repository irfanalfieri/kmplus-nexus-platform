import type { Messages } from '../en'

/** Bahasa Indonesia email copy; same shape as en/email.ts. */
export const email: Messages['email'] = {
  chrome: {
    product: 'Nexus',
    orPaste: 'Tombol tidak berfungsi? Salin tautan ini ke peramban Anda:',
    automated: 'Pesan ini dikirim otomatis oleh KMPlus Nexus. Balasan ke alamat ini tidak dibaca.',
    reason: 'Anda menerima email ini karena akun Anda di {url}.',
    openApp: 'Buka KMPlus Nexus',
  },
  verify: {
    subject: 'Konfirmasi email Anda untuk KMPlus Nexus',
    preheader: 'Satu klik untuk menyelesaikan pembuatan akun KMPlus Nexus Anda.',
    heading: 'Konfirmasi alamat email Anda',
    greeting: 'Halo {name},',
    body: 'Konfirmasikan bahwa ini alamat email Anda untuk menyelesaikan pembuatan akun KMPlus Nexus.',
    next: 'Setelah itu, Anda akan mengatur verifikasi dua langkah dengan aplikasi autentikator seperti Google Authenticator, Microsoft Authenticator, 1Password, atau Authy.',
    expires: 'Tautan berlaku selama 24 jam.',
    ignore: 'Jika Anda tidak membuat akun, abaikan email ini.',
    action: 'Konfirmasi email',
  },
  invite: {
    subject: '{inviter} mengundang Anda ke {workspace} di KMPlus Nexus',
    preheader: 'Bergabung dengan {workspace} di KMPlus Nexus.',
    heading: 'Anda diundang ke {workspace}',
    body: '{inviter} mengundang Anda bekerja bersama di KMPlus Nexus, platform yang menghubungkan, memeriksa, dan mengirimkan data SDM Anda.',
    howTo: 'Masuk atau buat akun dengan {email} untuk menerima undangan. Tautan hanya berlaku sekali dan kedaluwarsa dalam 7 hari.',
    workspace: 'Ruang kerja',
    role: 'Peran Anda',
    invitedBy: 'Diundang oleh',
    action: 'Terima undangan',
  },
  reset2fa: {
    subject: 'Verifikasi dua langkah KMPlus Nexus Anda disetel ulang',
    preheader: 'Atur ulang aplikasi autentikator Anda saat masuk berikutnya.',
    heading: 'Verifikasi dua langkah disetel ulang',
    body: '{admin}, admin {workspace}, menyetel ulang verifikasi dua langkah pada akun Anda dan mengeluarkan Anda dari semua perangkat.',
    next: 'Masuk dengan kata sandi Anda lalu atur aplikasi autentikator lagi.',
    warn: 'Jika Anda tidak memintanya, segera hubungi admin Anda.',
    action: 'Masuk',
  },
  alert: {
    error: 'Perlu perhatian',
    warning: 'Peringatan',
    info: 'Pembaruan',
    openQuality: 'Tinjau baris yang ditahan',
    openPipelines: 'Buka pipeline',
  },
}
