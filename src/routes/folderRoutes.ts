import { Router } from "express";
import { createFolder, getFolders, updateFolder } from "../handlers/folderHandlers";

const route = Router()

route.post('/', createFolder)
route.get('/:parentId', getFolders)
route.patch('/updateName', updateFolder)

export default route