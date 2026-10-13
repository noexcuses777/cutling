CREATE TABLE "Workspace" ("id" TEXT NOT NULL PRIMARY KEY, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Entity" ("id" TEXT NOT NULL PRIMARY KEY,"kind" TEXT NOT NULL,"ownerId" TEXT NOT NULL,"projectId" TEXT,"parentId" TEXT,"data" TEXT NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL,CONSTRAINT "Entity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "Entity_ownerId_kind_projectId_idx" ON "Entity"("ownerId","kind","projectId");
CREATE INDEX "Entity_ownerId_parentId_idx" ON "Entity"("ownerId","parentId");
CREATE TABLE "Credential" ("hash" TEXT NOT NULL PRIMARY KEY,"kind" TEXT NOT NULL,"ownerId" TEXT NOT NULL,"origin" TEXT,"expiresAt" DATETIME NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "Credential_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "Credential_ownerId_kind_idx" ON "Credential"("ownerId","kind");
