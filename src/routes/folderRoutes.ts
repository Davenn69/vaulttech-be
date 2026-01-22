import { Router } from "express";
import {
  addFavourite,
  createFolder,
  deleteFolder,
  getFavouriteFolders,
  getFolders,
  removeFavourite,
  restoreFolder,
  updateFolder,
} from "../handlers/folderHandlers";

const route = Router();

route.post("/", createFolder);

route.get("/:parentId", getFolders);
route.get("/favourite/:id", getFavouriteFolders);

route.patch("/updateName", updateFolder);
route.patch("/restore", restoreFolder);
route.patch("/addFavourite", addFavourite);
route.patch("/removeFavourite", removeFavourite);

route.delete("/delete/:id", deleteFolder);

export default route;
