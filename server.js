import express from "express";
import path from "path";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import dotenv from "dotenv";
import sharp from "sharp";
import morgan from "morgan";

dotenv.config();
const app = express();
app.use(morgan("combined"));

const __dirname = path.resolve();

// ------------------ ENV CONFIG ------------------ //
const PORT = process.env.PORT || 4000;
const UPLOADS_DIR = process.env.UPLOADS_DIR || "uploads";
const UPLOADS_URL =
  process.env.UPLOADS_URL || "https://cdn.soulcraftbd.com/uploads";
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || "https://soulcraftbd.com"
).split(",");
const MAX_FILES = parseInt(process.env.MAX_FILES || "20");
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || 2 * 1024 * 1024);
const ALLOWED_TYPES = (
  process.env.ALLOWED_TYPES || "image/jpeg,image/png,image/webp"
).split(",");

// Ensure upload folder exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ------------------ MIDDLEWARE ------------------ //
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests from specific origins or no-origin (server-side requests)
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// Serve static images with long-term caching
app.use(
  "/uploads",
  express.static(path.join(__dirname, UPLOADS_DIR), {
    maxAge: "60d",
    immutable: true,
    etag: true,
  })
);

// ------------------ MULTER SETUP ------------------ //
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Invalid file type (JPEG, PNG, WebP only)."));
  },
});

// ------------------ IMAGE COMPRESS FUNCTION ------------------ //
async function compressImage(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  const outputPath = path.join(__dirname, UPLOADS_DIR, filename);

  if ([".jpg", ".jpeg"].includes(ext)) {
    await sharp(buffer).jpeg({ quality: 80, mozjpeg: true }).toFile(outputPath);
  } else if (ext === ".png") {
    await sharp(buffer)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(outputPath);
  } else if (ext === ".webp") {
    await sharp(buffer).webp({ quality: 80 }).toFile(outputPath);
  } else {
    fs.writeFileSync(outputPath, buffer);
  }

  return `${UPLOADS_URL}/${filename}`;
}

// ------------------ ROUTES ------------------ //

// Root test route
app.get("/", (req, res) => {
  res.send(`
    <h1>✅ CDN Server is Live!</h1>
    <p>Access files: <a href="/uploads">/uploads</a></p>
  `);
});

// List all uploaded images
app.get("/images", (req, res) => {
  fs.readdir(path.join(__dirname, UPLOADS_DIR), (err, files) => {
    if (err)
      return res.status(500).json({ success: false, message: err.message });
    const images = files.map((file) => `${UPLOADS_URL}/${file}`);
    res.json({ success: true, images });
  });
});

// Upload a single image
app.post("/upload/single", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err)
      return res.status(400).json({
        success: false,
        message:
          err.code === "LIMIT_FILE_SIZE"
            ? "File too large (max 2MB)"
            : err.message,
      });

    try {
      const filename = `${Date.now()}-${req.file.originalname}`;
      const url = await compressImage(req.file.buffer, filename);
      res.json({ success: true, url });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });
});

// Upload multiple images
app.post("/upload/multiple", (req, res) => {
  upload.array("files", MAX_FILES)(req, res, async (err) => {
    if (err)
      return res.status(400).json({
        success: false,
        message:
          err.code === "LIMIT_FILE_SIZE"
            ? "Each file must be under 2MB"
            : err.message,
      });

    try {
      const urls = [];
      for (const file of req.files) {
        const filename = `${Date.now()}-${file.originalname}`;
        const url = await compressImage(file.buffer, filename);
        urls.push(url);
      }
      res.json({ success: true, urls });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });
});

// Delete image by filename
app.delete("/images/:filename", (req, res) => {
  const filePath = path.join(__dirname, UPLOADS_DIR, req.params.filename);
  fs.unlink(filePath, (err) => {
    if (err)
      return res
        .status(404)
        .json({ success: false, message: "File not found or already deleted" });
    res.json({ success: true, message: "Deleted successfully" });
  });
});

// ------------------ START SERVER ------------------ //
app.listen(PORT, () =>
  console.log(`🚀 CDN running at: http://127.0.0.1:${PORT}/uploads`)
);
