-- Baseline of the tables created at runtime by src/server/auth.ts and src/server/posts.ts.
-- Guards match that DDL so this is safe on an empty database and on one that already has the tables.

IF OBJECT_ID(N'dbo.AdminUser', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AdminUser (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_AdminUser PRIMARY KEY,
    Email nvarchar(320) NOT NULL,
    PasswordHash nvarchar(500) NOT NULL,
    CreatedAt datetimeoffset NOT NULL CONSTRAINT DF_AdminUser_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_AdminUser_Email UNIQUE (Email)
  );
END

IF OBJECT_ID(N'dbo.AdminSession', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AdminSession (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_AdminSession PRIMARY KEY,
    UserId uniqueidentifier NOT NULL,
    TokenHash varchar(64) NOT NULL,
    ExpiresAt datetimeoffset NOT NULL,
    CreatedAt datetimeoffset NOT NULL CONSTRAINT DF_AdminSession_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_AdminSession_User FOREIGN KEY (UserId) REFERENCES dbo.AdminUser (Id) ON DELETE CASCADE,
    CONSTRAINT UQ_AdminSession_TokenHash UNIQUE (TokenHash)
  );
  CREATE INDEX IX_AdminSession_ExpiresAt ON dbo.AdminSession (ExpiresAt);
END

IF COL_LENGTH(N'dbo.AdminUser', N'Role') IS NULL
  ALTER TABLE dbo.AdminUser ADD Role varchar(20) NOT NULL CONSTRAINT DF_AdminUser_Role DEFAULT 'admin';

IF COL_LENGTH(N'dbo.AdminUser', N'Disabled') IS NULL
  ALTER TABLE dbo.AdminUser ADD Disabled bit NOT NULL CONSTRAINT DF_AdminUser_Disabled DEFAULT 0;

IF COL_LENGTH(N'dbo.AdminUser', N'DisplayName') IS NULL
  ALTER TABLE dbo.AdminUser ADD DisplayName nvarchar(120) NULL;

IF OBJECT_ID(N'dbo.UserInvite', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.UserInvite (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_UserInvite PRIMARY KEY,
    Email nvarchar(320) NOT NULL,
    DisplayName nvarchar(120) NULL,
    Role varchar(20) NOT NULL,
    TokenHash varchar(64) NOT NULL,
    ExpiresAt datetimeoffset NOT NULL,
    AcceptedAt datetimeoffset NULL,
    RevokedAt datetimeoffset NULL,
    CreatedAt datetimeoffset NOT NULL CONSTRAINT DF_UserInvite_CreatedAt DEFAULT SYSUTCDATETIME(),
    InvitedBy uniqueidentifier NULL,
    CONSTRAINT UQ_UserInvite_TokenHash UNIQUE (TokenHash),
    CONSTRAINT FK_UserInvite_InvitedBy FOREIGN KEY (InvitedBy) REFERENCES dbo.AdminUser (Id) ON DELETE SET NULL
  );
  CREATE INDEX IX_UserInvite_Email ON dbo.UserInvite (Email);
END

IF OBJECT_ID(N'dbo.BlogPost', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.BlogPost (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_BlogPost PRIMARY KEY,
    Title nvarchar(200) NOT NULL,
    Slug varchar(180) NOT NULL,
    Summary nvarchar(500) NOT NULL CONSTRAINT DF_BlogPost_Summary DEFAULT N'',
    Tags nvarchar(500) NOT NULL CONSTRAINT DF_BlogPost_Tags DEFAULT N'',
    SeoKeywords nvarchar(500) NOT NULL CONSTRAINT DF_BlogPost_SeoKeywords DEFAULT N'',
    SeoTitle nvarchar(200) NOT NULL CONSTRAINT DF_BlogPost_SeoTitle DEFAULT N'',
    BodyHtml nvarchar(max) NOT NULL,
    Status varchar(20) NOT NULL CONSTRAINT DF_BlogPost_Status DEFAULT 'draft',
    AuthorId uniqueidentifier NOT NULL,
    CreatedAt datetimeoffset NOT NULL CONSTRAINT DF_BlogPost_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetimeoffset NOT NULL CONSTRAINT DF_BlogPost_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_BlogPost_Slug UNIQUE (Slug),
    CONSTRAINT FK_BlogPost_Author FOREIGN KEY (AuthorId) REFERENCES dbo.AdminUser (Id)
  );
  CREATE INDEX IX_BlogPost_UpdatedAt ON dbo.BlogPost (UpdatedAt DESC);
END
