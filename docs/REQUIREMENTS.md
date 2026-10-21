<!-- Extracted verbatim from Requirement.docx for reference -->

MASTER DEVELOPMENT PROMPT
VLedger AI — Multi-Workspace Accounting Web Application
PROJECT OBJECTIVE
Build a complete, production-ready AI-powered accounting web application using Next.js, PostgreSQL, and TypeScript.
The application must support multiple independent workspaces, a central Super Admin, separate Workspace Administrators, and multiple users within each workspace.
Users must be able to record financial transactions through voice commands, natural-language text, or manual forms.
Every transaction must record exactly who created it, who subsequently modified it, and when each action occurred.
The application must maintain accurate accounting records and support exporting financial data into a canonical JSON format, with software-specific adapters that generate compatible import files or API payloads for third-party accounting software.
Build a complete working application, not just a UI prototype.
1. TECH STACK
Frontend:
- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- shadcn/ui
- Lucide Icons
- Framer Motion
- Recharts
Backend:
- Next.js Route Handlers
- TypeScript
- Zod validation
- Secure authentication and authorization
Database:
- PostgreSQL
- Prisma ORM
- SQL migrations
- Workspace-scoped relational data
Authentication:
- Email/password
- Multi-factor authentication (TOTP)
- Secure session management
- Account recovery mechanisms
Email:
- Brevo Transactional Email API
AI:
- Natural-language financial transaction processing
- Voice-to-text support
- Configurable AI provider
- Rule-based fallback when AI is unavailable
- Confidence-based transaction review
The application must run locally on Windows and macOS without requiring Docker.
2. SUPER ADMIN MODULE
Create a separate, secure Super Admin area.
The Super Admin must be able to:
- Create new workspaces.
- View all workspaces.
- Edit workspace information.
- Activate, suspend, and archive workspaces.
- Assign one or more Workspace Admins.
- Send Workspace Admin invitations through Brevo.
- Manage workspace status.
- Configure default accounting settings.
- Configure available export integrations.
- View system-level activity logs.
- Monitor workspace usage.
- Manage platform-wide settings.
Workspace Creation
When the Super Admin creates a workspace, show a form containing:
- Workspace Name
- Workspace Code
- Company Name
- Company Email
- Country
- Default Currency
- Financial Year
- Time Zone
- Workspace Admin Name
- Workspace Admin Email
- Status
After saving:
- Create the workspace record.
- Generate a unique workspace ID.
- Initialize the workspace's chart of accounts.
- Create a pending Workspace Admin invitation.
- Send a secure invitation email using Brevo.
- Allow the invited admin to set their password.
- Require MFA setup according to the security policy.
- Activate the admin account following verification.
- Record the workspace creation event in the audit log.
Never send plaintext passwords through email.
Each workspace must have logically isolated financial records, settings, users, and export jobs.
3. WORKSPACE ADMIN MODULE
The Workspace Admin can manage only their assigned workspace.
Admin permissions:
- View workspace dashboard.
- Create users.
- Invite users by email.
- Assign user roles and permissions.
- Disable or reactivate users.
- Manage income and expenses.
- View transaction history.
- View who entered each transaction.
- Configure accounting categories.
- Manage bank and cash accounts.
- Configure chart of accounts.
- Review financial reports.
- Export accounting data.
- Manage workspace settings.
- View audit logs.
- Manage accounting software integrations.
User Creation
The Workspace Admin can create users with:
- Full Name
- Email Address
- Employee ID
- Department
- Role
- Assigned Permissions
- Account Status
Support granular permissions:
- Create Transactions
- View Transactions
- Edit Draft Transactions
- Post Transactions
- Reverse Transactions
- Approve Transactions
- View Reports
- Export Data
- Manage Accounts
- Manage Users
- View Audit Logs
Access must be enforced by backend authorization checks, not simply hidden UI buttons.
4. WORKSPACE USER MODULE
Each user receives an individual login.
After logging in, users must see only the workspace data and features they are authorized to access.
Provide:
- User Dashboard
- AI Expense Entry
- AI Income Entry
- Voice Transaction Entry
- Manual Transaction Entry
- My Transactions
- Transaction Details
- Profile
- Security Settings
If a user belongs to more than one workspace, provide a secure workspace switcher.
Never allow data leakage between workspaces.
5. TRANSACTION OWNERSHIP AND AUDIT TRAIL
THIS IS A MANDATORY FEATURE.
Every income, expense, transfer, and journal entry must retain user attribution.
Required Transaction Metadata
Each transaction must contain:
- Transaction ID
- Workspace ID
- Transaction Date
- Transaction Type
- Amount
- Currency
- Description
- Category
- Debit Account
- Credit Account
- Payment Method
- Status
- Created By User ID
- Created By User Name Snapshot
- Created At
- Last Modified By User ID
- Last Modified At
- Approved By User ID, if applicable
- Approved At, if applicable
- Entry Source: Voice / Text / Manual / Import
The Created By value must come from the authenticated server-side session.
Never allow users to submit arbitrary Created By identifiers.
Transaction Display
On all transaction tables, display:
| Date | Description | Amount | Type | Entered By | Status |
|---|---|---|---|---|---|
| 15 Oct 2026 | Office Rent | ₹15,000 | Expense | User A | Posted |
| 15 Oct 2026 | Service Payment | ₹50,000 | Income | User B | Posted |
| 15 Oct 2026 | Petrol | ₹1,500 | Expense | User C | Posted |

Allow filtering by:
- Entered By
- Date
- Category
- Amount
- Transaction Type
- Entry Source
- Approval Status
Transaction Audit History
Maintain an append-only audit event history recording:
- Actor User ID
- Actor Name Snapshot
- Workspace ID
- Transaction ID
- Action
- Timestamp
- Before and After values, when applicable
- Reason for changes
- Associated approval or reversal ID
Actions include:
CREATED, UPDATED, SUBMITTED, APPROVED, POSTED, REVERSED, and EXPORTED.
Do not allow users to modify or delete audit history.
Posted financial entries must be corrected through authorized reversal or adjustment entries.
Even if a user account is deactivated, historical transaction attribution must remain visible.
6. AI VOICE AND TEXT ACCOUNTING
The application must allow users to create financial entries naturally.
Example:
"Today I spent ₹2,500 for office electricity through HDFC Bank."
Expected extracted values:
- Type: Expense
- Amount: ₹2,500
- Category: Electricity Expense
- Payment Account: HDFC Bank
- Transaction Date: Today
- Entered By: Currently Logged-in User
- Source: Voice or Text
Another example:
"Received ₹75,000 from ABC Technologies for website development."
Expected result:
- Type: Income
- Amount: ₹75,000
- Customer: ABC Technologies
- Category: Service Revenue
- Description: Website Development
- Entered By: Current User
Implement:
- Voice recognition.
- Natural-language text extraction.
- Structured field detection.
- Category prediction.
- Account selection.
- Duplicate detection.
- Transaction review.
- Transaction posting.
- Audit event creation.
- Dashboard update.
If important information is missing, request clarification instead of guessing.
Allow configurable auto-posting only for safe, high-confidence entries with complete mappings.
Keep the core accounting workflow available without a paid AI API key.
7. DOUBLE-ENTRY ACCOUNTING ENGINE
Every posted transaction must create balanced debit and credit entries.
Example expense:
Debit: Office Electricity Expense — ₹2,500
Credit: HDFC Bank — ₹2,500
Support:
- Chart of Accounts
- General Ledger
- Journal Entries
- Journal Lines
- Trial Balance
- Balance Sheet
- Profit and Loss
- Cash Flow Reporting
- Account Reconciliation
- Opening Balances
- Transfers
- Adjustments
- Reversals
Use fixed-precision decimal amounts.
Maintain separate ledgers for each workspace.
Perform multi-line journal postings atomically.
Validate that the sum of debits equals the sum of credits before posting.
8. JSON ACCOUNTING EXPORT SYSTEM
THIS IS THE SECOND MOST IMPORTANT FEATURE.
Build a standardized accounting data export system that preserves complete transaction and audit information.
Each workspace must export only its own data.
Canonical JSON Structure
Example:
{
  "schemaVersion": "1.0",
  "exportType": "accounting_transactions",
  "workspace": {
    "workspaceId": "WS-001",
    "workspaceName": "ABC Technologies",
    "currency": "INR"
  },
  "transactions": [
    {
      "transactionId": "TXN-0001",
      "transactionDate": "2026-10-15",
      "type": "expense",
      "description": "Office Electricity",
      "amount": "2500.00",
      "currency": "INR",
      "category": "Electricity Expense",
      "paymentMethod": "Bank Transfer",
      "journalLines": [
        {
          "accountCode": "EXP-ELEC",
          "debit": "2500.00",
          "credit": "0.00"
        },
        {
          "accountCode": "BANK-HDFC",
          "debit": "0.00",
          "credit": "2500.00"
        }
      ],
      "audit": {
        "createdBy": {
          "userId": "USR-001",
          "name": "User A"
        },
        "createdAt": "2026-10-15T05:00:00Z",
        "source": "voice"
      }
    }
  ]
}
Required Export Capabilities
- Export all transactions.
- Export by selected workspace.
- Export by financial year.
- Export by custom date range.
- Export income.
- Export expenses.
- Export journal entries.
- Export account ledgers.
- Export by user.
- Export by category.
- Export by transaction status.
- Include financial audit information.
- Maintain transaction references.
- Prevent duplicate exports where appropriate.
- Validate journal balances before export.
The canonical JSON format must always retain transaction creator information.
9. ACCOUNTING SOFTWARE COMPATIBILITY
Create a modular accounting export adapter system.
IMPORTANT:
Do not assume every accounting application accepts JSON files directly.
Use one canonical JSON data model internally and convert it to each external system's verified, supported import format or API payload.
Prepare integration architecture for:
- TallyPrime
- Zoho Books
- QuickBooks
- Xero
- BUSY Accounting
- SAP
- Microsoft Dynamics
- Generic CSV-compatible accounting applications
- Generic JSON integrations
- Custom accounting software
Export Workflow
- Select workspace.
- Select transaction date range.
- Choose accounting software.
- Select transaction categories or accounts.
- Review account mappings.
- Validate required fields.
- Generate the compatible export.
- Download the file or initiate an authorized API transfer.
- Record the export event.
Adapter Requirements
Each integration adapter must define:
- Supported product and version
- Import mechanism
- Supported file type
- Required fields
- Account mapping rules
- Tax mapping rules
- Currency mapping
- Customer/vendor mapping
- Transaction reference rules
- Validation logic
- Error messages
- Import limitations
- Provenance metadata support
Use the official import specification or documented API for each integration.
If a target application cannot accept Created By as a structured field, map it into a supported custom field, narration, or memo where practical.
Always preserve the full user attribution in the canonical JSON and a separately downloadable audit metadata file.
Do not add unsupported columns or JSON properties to a native accounting import file.
When complete audit metadata cannot be transferred into the target application, clearly inform the user.
Export Center Interface
Provide:
- Accounting Software Selector
- Date Range
- Export Format
- Account Mapping
- Validation Status
- Export Preview
- Download
- Export History
Show integration states such as:
Available, Configuration Required, Validation Failed, and Not Implemented.
Never label unverified output as import-ready.
10. JSON IMPORT MODULE
Allow authorized users to import accounting data.
Implement:
- JSON upload
- Schema validation
- Workspace validation
- Transaction preview
- Category mapping
- Account mapping
- Duplicate detection
- Import confirmation
- Audit logging
- Error reporting
Imported transactions must preserve the original external creator information when available, while separately recording the authenticated user who performed the import.
Do not trust imported user identifiers as authenticated internal users.
11. DASHBOARD DESIGN
Design a premium, responsive SaaS accounting dashboard.
Super Admin Dashboard
Show:
- Total Workspaces
- Active Workspaces
- Suspended Workspaces
- Total Users
- Workspace Activity
- Integration Health
- Recent Platform Actions
Workspace Admin Dashboard
Show:
- Total Income
- Total Expenses
- Net Profit
- Bank and Cash Balances
- Monthly Financial Trends
- Expense Category Breakdown
- Recent Transactions
- Transactions by User
- Pending Approvals
- Export History
User Dashboard
Show:
- My Transactions
- My Recorded Income
- My Recorded Expenses
- Recent Activity
- Quick Voice Entry
- Quick Text Entry
Financial information must be shown according to permissions.
12. MODERN UI AND LIGHT/DARK MODE
Create a visually premium, modern financial application.
Light Theme:
- Off-white backgrounds
- White cards
- Slate text
- Indigo/blue primary colors
- Green for income
- Red for expenses
Dark Theme:
- Deep navy and charcoal surfaces
- Subtle elevated panels
- White and muted gray typography
- Clear accessible accent colors
Include:
- Collapsible sidebar
- Modern top navigation
- Workspace switcher
- User profile dropdown
- Theme toggle
- Smooth page transitions
- Animated dashboard charts
- Elegant data tables
- Search and filters
- Toast notifications
- Loading skeletons
- Mobile-responsive layouts
Avoid excessive glassmorphism and distracting animation.
Provide distinct layouts for Super Admin and Workspace users.
13. AUTHENTICATION AND BREVO EMAIL
Implement secure role-based login with MFA.
Use Brevo API for:
- Workspace Admin Invitations
- New User Invitations
- Email Verification
- Password Reset
- MFA Security Notifications
- Suspicious Login Alerts
- Account Activation
- Optional Daily/Monthly Transaction Summaries
Use authenticator app-based TOTP for MFA.
Require MFA for Super Admin and Workspace Admin accounts.
Provide secure backup recovery codes.
Store Brevo API credentials only on the backend through environment variables.
Use rate limiting and secure sessions.
14. POSTGRESQL DATABASE DESIGN
Create normalized database tables including:
- users
- organizations / workspaces
- workspace_memberships
- workspace_invitations
- roles
- permissions
- role_permissions
- sessions
- mfa_credentials
- accounts
- account_categories
- transactions
- journal_entries
- journal_lines
- customers
- vendors
- approvals
- audit_events
- import_jobs
- export_jobs
- integration_adapters
- integration_account_mappings
- workspace_settings
- notification_logs
All workspace-owned financial tables must include a workspace identifier.
Enforce workspace-level isolation in server queries and authorization.
Store Created By, Updated By, and Approved By using appropriate relationships.
Maintain immutable audit history independently of editable transaction draft records.
Use database constraints and transactions to guarantee accounting integrity.
15. TESTING REQUIREMENTS
Test these complete workflows:
Scenario 1 — Super Admin
Super Admin logs in with MFA, creates Workspace A, and invites Workspace Admin A.
Expected: Workspace A is successfully created and Admin A can activate their account.
Scenario 2 — Workspace Admin
Admin A logs in and creates User A and User B.
Expected: Both receive invitations and can log in with their assigned permissions.
Scenario 3 — User Expense Entry
User A records an expense through voice input.
Expected:
- Transaction created.
- Correct workspace assigned.
- Created By = User A.
- Created At recorded.
- Balanced journal posted.
- Audit history saved.
Scenario 4 — Another User
User B records income.
Expected:
- Created By = User B.
- Records remain distinct.
- Admin can filter by User A and User B.
Scenario 5 — Workspace Separation
An admin from Workspace B attempts to access Workspace A's transactions.
Expected: Access denied.
Scenario 6 — JSON Export
Admin A exports Workspace A's accounting data.
Expected:
- Correct workspace data only.
- Valid JSON.
- Correct journal entries.
- Transaction creator information included.
- Accurate financial amounts.
Scenario 7 — Accounting Software Export
Admin A selects a supported accounting application.
Expected:
- Adapter validates transactions.
- Account mappings applied.
- Supported import file or API payload generated.
- No unsupported fields added.
- Full audit metadata remains available separately.
- Unsupported integrations clearly identified.
Scenario 8 — Audit Trail
An authorized user edits a draft or reverses a posted transaction.
Expected: Original creator identity is retained and a new audit event records the action.
16. FINAL DELIVERABLES
Generate the complete Next.js application with:
- Full project source code
- Super Admin Panel
- Workspace Admin Panel
- User Dashboard
- PostgreSQL database
- Prisma migrations
- Workspace isolation
- User permissions
- MFA authentication
- Brevo API integration
- Voice and text accounting
- Double-entry accounting engine
- Transaction audit trails
- Financial reports
- Canonical JSON export
- Extensible accounting software adapters
- Modern light/dark interface
- Database seed data
- Environment configuration
- Local setup instructions
- API documentation
- Automated tests
- Production deployment documentation
Implement functionality in stages, ensuring each stage is working and tested before moving to the next.
Do not generate placeholder buttons or mock accounting functionality and present them as finished.
Build a secure, scalable, user-friendly multi-workspace accounting platform where every financial transaction is traceable to its creator and can be converted into verified, supported third-party accounting exchange formats.
