const SoundCloud = require("./index.js");
const fs = require("node:fs");
const { pipeline } = require("node:stream/promises");

const sc = new SoundCloud();

(async () => {
	try {
		console.log("Đang khởi tạo và lấy stream...");
		const url = "https://soundcloud.com/jar-chow-794199690/etoilesong-by-vermementomori-ost";

		const stream = await sc.downloadTrack(url);

		if (!stream) {
			console.error("Không lấy được stream.");
			return;
		}

		const filename = "track.ts"; // HLS thường là định dạng MPEG-TS
		const writeStream = fs.createWriteStream(filename);

		console.log("Đang tải dữ liệu...");

		// Theo dõi tiến trình (optional)
		let downloaded = 0;
		stream.on("data", (chunk) => {
			downloaded += chunk.length;
			process.stdout.write(`\rĐã tải: ${(downloaded / 1024).toFixed(2)} KB`);
		});

		await pipeline(stream, writeStream);

		console.log(`\n✅ Tải xong! File lưu tại: ${filename}`);
	} catch (err) {
		console.error("\n❌ Lỗi trong quá trình tải:", err.message);
	}
})();
