import { Router } from "express";
import {
  deleteFile,
  getFiles,
  updateName,
  uploadFile,
  getDeletedFiles,
  downloadFile,
  selectFavourites,
  addFavourite,
  removeFavourite,
  restoreFile,
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
    // Accept only Word, Excel, and PDF files
    const allowedMimes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only Word, Excel, and PDF files are allowed.",
        ),
      );
    }
  },
});

route.post("/uploadFile", upload.single("file"), uploadFile);

route.get("/deleted", getDeletedFiles);
route.get("/favourite", selectFavourites);
route.get("/download/:id", downloadFile);
route.get("/:id", getFiles);

route.patch("/updateName", updateName);
route.patch("/addFavourite", addFavourite);
route.patch("/removeFavourite", removeFavourite);
route.patch("/restore", restoreFile);

route.delete("/delete/:id", deleteFile);

export default route;
