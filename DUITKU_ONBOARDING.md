# Checklist verifikasi Duitku untuk CourtVision

Dokumen ini adalah urutan aman untuk menyelesaikan permintaan tim onboarding Duitku. Jangan menaruh API Key, PIN, OTP, nomor kartu, atau data rekening di file ini maupun GitHub.

## 1. Informasi yang harus tampil di halaman utama

- Produk: CourtVision Pro, perangkat lunak analisis video pertandingan basket.
- Paket bulanan: Rp130.000 untuk akses 30 hari.
- Paket tahunan: Rp1.040.000 untuk akses 365 hari.
- Email support: support@courtvision.id.
- Nomor telepon/WhatsApp support: 081343447079.
- Alamat usaha: Apartemen Bassura City, Tower C, Unit 22 CP, Jalan Basuki Rahmat No. 1A.

## 2. Konfigurasi Sandbox Duitku

Data yang diperlukan dari dashboard Duitku:

- Merchant Code Sandbox. Data ini boleh dimasukkan sebagai konfigurasi Worker.
- API Key Sandbox. Data ini harus dimasukkan langsung sebagai Cloudflare Worker secret dan tidak boleh dikirim melalui chat atau disimpan di repository.

Endpoint yang sudah disiapkan:

- Daftar metode pembayaran: `GET /v1/billing/duitku/methods`
- Pembuatan checkout: `POST /v1/billing/duitku/checkout`
- Callback Duitku: `POST /v1/webhooks/duitku`
- Status pesanan: `GET /v1/billing/duitku/orders/:orderId`

## 3. Skenario uji Sandbox

1. Buka halaman checkout CourtVision.
2. Pilih paket bulanan Rp130.000.
3. Isi nama, email akun CourtVision, dan nomor telepon pengujian.
4. Pilih metode Sandbox yang aktif.
5. Lanjutkan ke halaman pembayaran Duitku.
6. Selesaikan transaksi menggunakan fasilitas demo Sandbox Duitku.
7. Pastikan pengguna kembali ke halaman status CourtVision.
8. Pastikan status pesanan berubah menjadi `paid` hanya setelah callback dan pemeriksaan status dari server Duitku berhasil.
9. Masuk ke extension menggunakan Google dengan email pembelian yang sama.
10. Pastikan CourtVision menampilkan Pro aktif dan batas satu laptop tetap berlaku.

## 4. Naskah video penggunaan untuk tim Duitku

Durasi yang disarankan: 3–5 menit. Jangan memperlihatkan API Key, license key, OTP, PIN, data rekening, atau dokumen identitas.

1. Tampilkan alamat `https://courtvision.id`.
2. Tunjukkan deskripsi CourtVision, fitur produk, harga Rupiah, dan kontak support.
3. Tunjukkan extension CourtVision pada video pertandingan YouTube.
4. Buat 2–3 tag pertandingan dan buka daftar klip.
5. Tunjukkan ekspor laporan WhatsApp atau pemutaran klip.
6. Kembali ke website dan pilih paket bulanan.
7. Isi checkout menggunakan data pengujian.
8. Pilih metode pembayaran Duitku Sandbox.
9. Tunjukkan perpindahan ke halaman pembayaran Sandbox Duitku.
10. Setelah pembayaran demo berhasil, tunjukkan halaman status CourtVision dan Pro aktif pada extension.
11. Jelaskan bahwa klip disimpan lokal di perangkat; server hanya memproses akun, lisensi, dan status pembayaran.

## 5. Pemeriksaan sebelum membalas Duitku

- Nomor telepon dan alamat usaha sudah terlihat di halaman utama.
- Checkout dapat dibuka dari tombol harga bulanan dan tahunan.
- Metode pembayaran berasal dari proyek Duitku Sandbox yang aktif.
- Nominal pesanan tidak dapat diubah dari browser.
- Callback memakai HMAC-SHA256 dan status diverifikasi ke server Duitku.
- API Key hanya tersimpan sebagai Worker secret.
- Video penggunaan dapat dibuka melalui tautan berbagi yang tidak meminta izin khusus.
- Seluruh pengujian dilakukan di Sandbox, bukan transaksi produksi.
