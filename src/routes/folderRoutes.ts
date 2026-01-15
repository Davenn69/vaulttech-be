import { Router } from "express";
import { createFolder, deleteFolder, getFolders, restoreFolder, updateFolder } from "../handlers/folderHandlers";

const route = Router()

route.post('/', createFolder)

route.get('/:parentId', getFolders)

route.patch('/updateName', updateFolder)
route.patch('/restore', restoreFolder)

route.delete('/delete/:id', deleteFolder)

export default route