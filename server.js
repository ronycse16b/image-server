import express from "express";
import path from "path";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import dotenv from "dotenv";
import sharp from "sharp";
import morgan from "morgan";
import PQueue from "p-queue"; // for limiting parallel jobs

dotenv.config();
const app = express();
const __dirname = path.resolve();

// ------------------ ENV ------------------ //
const PORT = process.env.PORT || 4000;
const UPLOADS_DIR = process.env.UPLOADS_DIR || "uploads";
const UPLOADS_URL =
  process.env.UPLOADS_URL || "https://cdn.soulcraftbd.com/uploads";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS.split(",");

const MAX_FILES = parseInt(process.env.MAX_FILES || "20");
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || 10 * 1024 * 1024);
const ALLOWED_TYPES = (
  process.env.ALLOWED_TYPES || "image/jpeg,image/png,image/webp,image/gif"
).split(",");

// Ensure upload folder exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ------------------ MIDDLEWARE ------------------ //
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(morgan("dev"));
app.use(
  cors({
    origin: (origin, callback) =>
      !origin || ALLOWED_ORIGINS.includes(origin)
        ? callback(null, true)
        : callback(new Error("Not allowed by CORS")),
    credentials: true,
  })
);

// Serve static images with caching
app.use(
  "/uploads",
  express.static(path.join(__dirname, UPLOADS_DIR), {
    maxAge: "365d",
    immutable: true,
  })
);

// ------------------ MULTER ------------------ //
// Use disk storage to avoid memory spike
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.random().toString(36).substring(2);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (req, file, cb) =>
    ALLOWED_TYPES.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`Invalid file type: ${file.mimetype}`)),
});

// ------------------ BACKGROUND QUEUE ------------------ //
const queue = new PQueue({ concurrency: 2 });

async function optimizeImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const tempPath = filePath + ".tmp";

  try {
    if ([".jpg", ".jpeg"].includes(ext)) {
      await sharp(filePath)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 75, mozjpeg: true })
        .toFile(tempPath);
    } else if (ext === ".png") {
      await sharp(filePath)
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(tempPath);
    } else if (ext === ".webp") {
      await sharp(filePath)
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(tempPath);
    } else {
      // gif or unsupported
      return;
    }

    fs.renameSync(tempPath, filePath);
    console.log(`✅ Optimized: ${filePath}`);
  } catch (err) {
    console.error(`❌ Optimize failed: ${filePath}`, err);
  }
}

// ------------------ ROUTES ------------------ //

// Root test
app.get("/", (req, res) => {
  res.send(
    `<h1>CDN Server Live</h1><p>Uploads: <a href="/uploads">/uploads</a></p>`
  );
});

// Single upload route
app.post("/upload/single", upload.single("file"), (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded" });

  const url = `${UPLOADS_URL}/${req.file.filename}`;

  // Return immediately to client
  res.json({ success: true, url });

  // Background optimize
  queue.add(() => optimizeImage(req.file.path));
});

// Multiple upload route
app.post("/upload/multiple", upload.array("files", MAX_FILES), (req, res) => {
  if (!req.files || req.files.length === 0)
    return res
      .status(400)
      .json({ success: false, message: "No files uploaded" });

  const urls = req.files.map((file) => `${UPLOADS_URL}/${file.filename}`);

  // Return immediately to client
  res.json({ success: true, urls, count: urls.length });

  // Background optimize
  req.files.forEach((file) => {
    queue.add(() => optimizeImage(file.path));
  });
});

// ------------------ DELETE ------------------ //
app.delete("/images/:filename", (req, res) => {
  const filePath = path.join(__dirname, UPLOADS_DIR, req.params.filename);
  fs.unlink(filePath, (err) => {
    if (err)
      return res
        .status(404)
        .json({ success: false, message: "File not found" });
    res.json({ success: true, message: "Deleted" });
  });
});

// ------------------ ERROR HANDLER ------------------ //
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ success: false, message: err.message });
});

// ------------------ START SERVER ------------------ //
app.listen(PORT, () => {
  console.log(`🚀 CDN Server running on port ${PORT}`);
});
