import multer from 'multer';
import fs from 'fs';

// Configure multer to store files in uploads directory
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = '/tmp/uploads';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

export { upload };