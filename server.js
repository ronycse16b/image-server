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

const __dirname = path.resolve();

// ------------------ ENV CONFIG ------------------ //
const PORT = process.env.PORT || 4000;
const UPLOADS_DIR = process.env.UPLOADS_DIR || "uploads";
const UPLOADS_URL =
  process.env.UPLOADS_URL || "https://cdn.soulcraftbd.com/uploads";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS.split(",");

const MAX_FILES = parseInt(process.env.MAX_FILES || "20");
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || 10 * 1024 * 1024); // 10MB
const ALLOWED_TYPES = (
  process.env.ALLOWED_TYPES || "image/jpeg,image/png,image/webp,image/gif"
).split(",");

// Ensure upload folder exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ------------------ MIDDLEWARE ------------------ //
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(morgan("dev"));

// Increase timeout for all requests (5 minutes)
app.use((req, res, next) => {
  req.setTimeout(300000); // 5 minutes
  res.setTimeout(300000);
  next();
});

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

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
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${ALLOWED_TYPES.join(", ")}`));
    }
  },
});

// ------------------ IMAGE COMPRESS FUNCTION (OPTIMIZED) ------------------ //
async function compressImage(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  const outputPath = path.join(__dirname, UPLOADS_DIR, filename);

  try {
    if ([".jpg", ".jpeg"].includes(ext)) {
      await sharp(buffer)
        .jpeg({ quality: 75, mozjpeg: true }) // Reduced quality for speed
        .toFile(outputPath);
    } else if (ext === ".png") {
      await sharp(buffer)
        .png({ compressionLevel: 6 }) // Reduced compression for speed
        .toFile(outputPath);
    } else if (ext === ".webp") {
      await sharp(buffer)
        .webp({ quality: 75 }) // Reduced quality for speed
        .toFile(outputPath);
    } else if (ext === ".gif") {
      // GIF doesn't compress well, just save it
      fs.writeFileSync(outputPath, buffer);
    } else {
      fs.writeFileSync(outputPath, buffer);
    }

    return `${UPLOADS_URL}/${filename}`;
  } catch (error) {
    console.error(`Compression error for ${filename}:`, error);
    throw error;
  }
}

// ------------------ ROUTES ------------------ //

// Root test route
app.get("/", (req, res) => {
  res.send(`
    <h1>✅ CDN Server is Live!</h1>
    <p>Access files: <a href="/uploads">/uploads</a></p>
    <p>Max file size: ${MAX_FILE_SIZE / (1024 * 1024)}MB per file</p>
    <p>Max files: ${MAX_FILES} files per request</p>
  `);
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "running",
    maxFileSize: `${MAX_FILE_SIZE / (1024 * 1024)}MB`,
    maxFiles: MAX_FILES,
  });
});

// List all uploaded images
app.get("/images", (req, res) => {
  fs.readdir(path.join(__dirname, UPLOADS_DIR), (err, files) => {
    if (err)
      return res.status(500).json({ success: false, message: err.message });
    const images = files.map((file) => `${UPLOADS_URL}/${file}`);
    res.json({ success: true, images, count: images.length });
  });
});

// Upload a single image
app.post("/upload/single", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({
        success: false,
        message:
          err.code === "LIMIT_FILE_SIZE"
            ? `File too large (max ${MAX_FILE_SIZE / (1024 * 1024)}MB)`
            : err.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    try {
      const filename = `${Date.now()}-${req.file.originalname}`;
      console.log(`Processing single file: ${filename}`);
      const url = await compressImage(req.file.buffer, filename);
      console.log(`✅ Uploaded: ${filename}`);
      res.json({ success: true, url });
    } catch (err) {
      console.error("Compression error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  });
});

// Upload multiple images (PARALLEL PROCESSING)
app.post("/upload/multiple", (req, res) => {
  upload.array("files", MAX_FILES)(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({
        success: false,
        message:
          err.code === "LIMIT_FILE_SIZE"
            ? `Each file must be under ${MAX_FILE_SIZE / (1024 * 1024)}MB`
            : err.code === "LIMIT_UNEXPECTED_FILE"
            ? `Too many files. Max ${MAX_FILES} files allowed`
            : err.message,
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded",
      });
    }

    console.log(`📦 Processing ${req.files.length} files...`);

    try {
      // PARALLEL PROCESSING - সব files একসাথে process হবে
      const uploadPromises = req.files.map(async (file, index) => {
        const timestamp = Date.now() + index; // Unique timestamp
        const random = Math.random().toString(36).substring(7);
        const filename = `${timestamp}-${random}-${file.originalname}`;

        console.log(
          `⏳ Processing ${index + 1}/${req.files.length}: ${filename}`
        );

        try {
          const url = await compressImage(file.buffer, filename);
          console.log(
            `✅ Completed ${index + 1}/${req.files.length}: ${filename}`
          );
          return { success: true, url, filename };
        } catch (error) {
          console.error(
            `❌ Failed ${index + 1}/${req.files.length}: ${filename}`,
            error
          );
          return { success: false, filename, error: error.message };
        }
      });

      // Wait for all uploads to complete
      const results = await Promise.all(uploadPromises);

      // Separate successful and failed uploads
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      console.log(
        `✅ Upload complete: ${successful.length} success, ${failed.length} failed`
      );

      if (successful.length === 0) {
        return res.status(500).json({
          success: false,
          message: "All uploads failed",
          failed,
        });
      }

      res.json({
        success: true,
        urls: successful.map((r) => r.url),
        count: successful.length,
        total: req.files.length,
        failed: failed.length > 0 ? failed : undefined,
      });
    } catch (err) {
      console.error("❌ Processing error:", err);
      res.status(500).json({
        success: false,
        message: "Upload processing failed: " + err.message,
      });
    }
  });
});

// Delete image by filename
app.delete("/images/:filename", (req, res) => {
  const filePath = path.join(__dirname, UPLOADS_DIR, req.params.filename);
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error("Delete error:", err);
      return res
        .status(404)
        .json({ success: false, message: "File not found or already deleted" });
    }
    console.log(`🗑️ Deleted: ${req.params.filename}`);
    res.json({ success: true, message: "Deleted successfully" });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// ------------------ START SERVER ------------------ //
const server = app.listen(PORT, () => {
  console.log(`🚀 CDN Server running`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`📁 Uploads: ${UPLOADS_URL}`);
  console.log(`📊 Max file size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  console.log(`📦 Max files: ${MAX_FILES} per request`);
  console.log(`⏱️  Timeout: 5 minutes`);
});

// Set server timeout
server.timeout = 300000; // 5 minutes

// update server 12-12-2025 - Parallel processing for multiple uploads
