import { Router } from "express";
import {
  deleteFile,
  deletePermanentFile,
  getFiles,
  updateName,
  uploadFile,
  getDeletedFiles,
  downloadFile,
  selectFavourites,
  addFavourite,
  removeFavourite,
  restoreFile,
  moveFile,
  addFileToCertainCategory,
  removeCategoryFromFile,
  getFileUrl,
  getPhotoUrl,
  getSharedFiles,
} from "../handlers/fileHandlers";
import multer from "multer";

const route = Router();
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    // Accept only Word, Excel, PowerPoint, PDF, and image files
    const allowedMimes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "image/jpeg",
      "image/png",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only Word, Excel, PowerPoint, PDF, and JPG/PNG/JPEG files are allowed.",
        ),
      );
    }
  },
});

route.post("/uploadFile", upload.single("file"), uploadFile);

route.get("/shared", getSharedFiles);
route.get("/deleted", getDeletedFiles);
route.get("/favourite", selectFavourites);
route.get("/download/:id", downloadFile);
route.get("/:id", getFiles);
route.get("/:id/signedUrl", getFileUrl);
route.get("/:id/photo", getPhotoUrl);

route.patch("/updateName", updateName);
route.patch("/addFavourite", addFavourite);
route.patch("/removeFavourite", removeFavourite);
route.patch("/restore", restoreFile);
route.patch("/move", moveFile);
route.patch("/addCategory", addFileToCertainCategory);
route.patch("/removeCategory", removeCategoryFromFile);

route.delete("/delete/:id", deleteFile);
route.delete("/permanent/:id", deletePermanentFile);

export default route;
