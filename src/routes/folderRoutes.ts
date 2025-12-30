import { Router } from "express";
import { createFolder, getFolders } from "../handlers/folderHandlers";

const route = Router()

route.post('/', createFolder)
route.get('/:parentId', getFolders)

export default route