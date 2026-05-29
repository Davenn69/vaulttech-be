import { Router } from "express";
import {
  addFavourite,
  createFolder,
  deleteFolder,
  getDeletedFolders,
  getFavouriteFolders,
  getFolders,
  getSharedFolders,
  removeFavourite,
  deletePermanentFolder,
  restoreFolder,
  updateFolder,
} from "../handlers/folderHandlers";

const route = Router();

route.post("/", createFolder);

route.get("/shared", getSharedFolders);
route.get("/favourite", getFavouriteFolders);
route.get("/deleted", getDeletedFolders);
route.get("/:parentId", getFolders);

route.patch("/updateName", updateFolder);
route.patch("/restore", restoreFolder);
route.patch("/addFavourite", addFavourite);
route.patch("/removeFavourite", removeFavourite);

route.delete("/delete/:id", deleteFolder);
route.delete("/permanent/:id", deletePermanentFolder);

export default route;
