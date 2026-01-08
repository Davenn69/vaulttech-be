import { Router } from "express";
import { createFolder, deleteFolder, getFolders, updateFolder } from "../handlers/folderHandlers";

const route = Router()

route.post('/', createFolder)
route.get('/:parentId', getFolders)
route.patch('/updateName', updateFolder)
route.delete('/delete/:id', deleteFolder)

export default route