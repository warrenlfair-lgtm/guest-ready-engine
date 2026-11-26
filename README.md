# Guest Ready™

Vacation Rental Pool Service Scheduling Platform

## Features

- Property Management
- iCal Reservation Sync
- Guest Ready Turnover Scheduling
- Weekly Service Scheduling
- Same-Day Turnover Alerts
- Task Tracking
- Invoice Tracking
- Calendar View
- List View

## Tech Stack

- HTML
- CSS
- JavaScript
- Supabase
- GitHub

## Admin, Manager, and Staff Access

Guest Ready Engine uses Supabase Auth for sign-in and `public.app_user_roles` for application authorization. Supported roles are `admin`, `manager`, and `staff`; authenticated users without an active role are signed out and receive no application data.

Before enabling role-based access, run the existing schema migrations used by the application, including the cleaning-task labor tracking, paid labor classification, chemical usage, invoice/expense, and Lawn Service migrations. Then run `supabase_setup_role_based_access.sql`, `supabase_fix_staff_operational_views.sql`, `supabase_setup_manager_role.sql`, and `supabase_setup_manager_reconciliation.sql` manually in that order in the Supabase SQL Editor. Review the bootstrap email near the top of the role-based migration before running it; it currently preserves `warren.l.fair@gmail.com` as an active admin.

To add the first staff account:

1. Create or invite the user in Supabase Dashboard under Authentication > Users.
2. Sign in with an Admin account and open Settings > Authorized Users.
3. Set the user's role to Staff, leave Active enabled, and save.

Staff can use Pool Service, Lawn, and Maintenance Today/Week operations and start and complete tasks. Pool tasks retain checklist and chemical-quantity tools. Financial tables remain protected by admin-only row-level security; staff reads use restricted views that omit financial columns, and staff writes use role-checked RPC functions.

Managers can use Pool Service, Lawn, and Maintenance Today, Week, Month, and Properties views. The Properties view is limited to Current Month and Next Month. Manager reads use dedicated operational-only views, and task assignments, service levels, notes, starts, completions, and completed-task reconciliation use role-checked RPC functions. Reconciliation eligibility is exposed only as boolean fields; configured charges and invoice data remain server-side, Manager views expose no financial columns, and Managers cannot access the Invoices page.

## Guest Ready Command Center

`command-center.html` is a read-only display, and `command-center-manage.html` is the task and note editor for active admins and managers. The Command Center link in the application opens a new tab; managers can use the separate Tasks & Notes link. Display accounts have no task or note write access. The dashboard never runs scheduling or iCal synchronization.

Before deploying, test and run `supabase_setup_command_center.sql` in a staging Supabase project after the role, VP², reservation, and task migrations. This migration adds separate task/note tables and narrow role-checked RPCs. To provision a display, create a dedicated Supabase Auth user and insert its UUID into `public.command_center_display_accounts` using the Supabase SQL Editor as a database administrator. Set `active` to false to revoke display access. Do not assign the kiosk an admin or manager role. Sign in on the kiosk; Supabase retains and refreshes the session when the browser supports persistent storage. The dashboard clears data if authorization expires or is revoked and displays stale data during temporary network failures. Kiosk and main-app tabs on the same origin share a browser session, so use a separate browser profile or device for the display account.

Run `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/command_center.test.js` for focused date and counter tests. Verify authorization, migrations, live refresh, overflow, and display readability in staging on the target kiosk browser before production deployment.

The overdue counter separates today's unfinished carried-forward service tasks, overdue VP² reviews, and overdue special tasks. Historical service tasks outside today's route are not counted. Overdue VP² reviews are limited to the current Monday–Sunday week, matching the main VP² dashboard's default week; outstanding reviews from earlier weeks remain unchanged and can be found by browsing prior weeks there. The Command Center also shows upcoming reviews through six days after today. After updating an existing Command Center installation, rerun the updated `supabase_setup_command_center.sql` before deploying the matching frontend.

Today's and tomorrow's services appear in the schedule. Guest arrivals are shown in the check-in counter and seven-day outlook rather than separate arrivals panels.
The Command Center display does not show pinned notes; existing notes remain available in the task and note editor.
The dashboard refreshes data every five minutes and updates the clock every second. It also refreshes on reconnection and at the Eastern midnight rollover. The footer shows the connection status and the date and time of the last successful data update in Eastern Time; a stale connection retains that last successful timestamp.

## Customer Communications

Before deploying, test and run `supabase_setup_customer_communications.sql` in a staging Supabase project after `supabase_setup_role_based_access.sql`, `supabase_setup_manager_role.sql`, and `supabase_setup_properties_client_name.sql`. It adds templates, published greeting snapshots, recipients, opaque links, and manual-send history in separate tables. Direct access is revoked for application roles; admin-only RPCs manage the feature, and a narrow public RPC exposes only the published greeting and, if selected, the reviewed first name. Supabase Vault and pgcrypto must be available. Test the migration, Vault token recovery, anonymous and non-admin access, and link revocation against staging before production deployment.

Admins open Customer Communications from the main navigation. Active customers are approximated by the exact trimmed client/owner name on active properties, not by a verified customer ID. Multiple properties with the same name are grouped; different people with an identical name cannot be distinguished, spelling variants may produce duplicate entries, and unnamed properties are omitted. Review the list and edit recipient labels and first names before publishing; these edits do not change customer or property records. First names are never guessed. The original source name is retained for audit. If a distinct customer cannot be represented safely by these groups, resolve the underlying records through the normal customer-management workflow before sending.

Templates can be edited without changing published snapshots. Preview before publishing; generic greetings use one shared link, while personalized greetings use one link per selected customer. The first name on a personalized greeting is visible to anyone possessing that link. Banner URLs must be publicly accessible HTTPS images; their provider can see visitors' IP addresses, so do not include private data in an image URL. Public links contain opaque tokens in the URL fragment; anyone with a link can forward it. Avoid putting private information in greeting content. Archiving or deactivating a greeting both immediately make all its links unavailable and preserve its history; neither action sends a message. Copying a text does not record a send. Use “Record manual send” only after sending independently; each entry is a manual record, not proof of delivery. No delivery service is integrated.

Greeting pages serve static Open Graph metadata and a public 1200×630 holiday banner at `https://guest-ready-engine.netlify.app/assets/holiday-preview.png`. Previews are generic, not the custom greeting or recipient name: link-preview crawlers do not receive the token in the URL fragment. Some messaging apps cache previews, omit them, or treat the generic `og:url` as the destination; test both the preview and the actual tapped link with supported apps after deployment. If the deployment domain changes, update the absolute `og:image` and `og:url` values in `greeting.html`.

To attach a card instead, select “Open greeting / save image” for a recipient in communication history, then “Save Greeting Image.” The resulting PNG contains the greeting text and any personalized first name, so verify it before sending. The card includes the configured banner when its host permits cross-origin image access; a host that does not permit it produces an explicit error. Very long greetings may need shortening to fit browser canvas limits. A saved image is a standalone copy and cannot be revoked when its link is deactivated.

Run `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/customer_communications.test.js` for focused client validation tests. Test a generic and a personalized greeting on mobile, multiple-property and ambiguous names, preview, copying, repeated manual records, admin/non-admin/anonymous permissions, token recovery, and both archive and deactivate in staging. No live migration or deployment is performed automatically.

## Maintenance Branch Setup

Run `supabase_setup_maintenance_branch.sql` in the Supabase SQL Editor before deploying the three-branch frontend. This additive migration allows `maintenance` in existing branch constraints and updates Manager task creation and Pipeline scheduling to preserve it. It does not update or reclassify historical rows; existing `lawn` tasks and recurring Lawn generation remain Lawn.

## Month Task Rescheduling

Run `supabase_setup_month_task_rescheduling.sql` in the Supabase SQL Editor before deploying Month View drag-and-drop. The migration adds a role-checked Admin/Manager RPC and a non-financial Manager eligibility flag. Rescheduling updates only the existing task's `service_date`, `scheduled_date`, and `manually_modified` fields; it never inserts or duplicates a task. Completed, historical, reconciled, and invoice-linked tasks remain locked. Operational "today" is evaluated in the `America/New_York` business timezone so work scheduled for the current local date remains movable after UTC midnight.

## VP² Enhanced Monitoring Billing

Run `supabase_setup_vp2e_billing.sql` after the existing invoice, Same-Day Surcharge, and VP² invoice migrations, then deploy the matching frontend. The additive migration defaults existing properties to VP²E disabled with a $15.00 weekly fee and enforces one VP²E invoice line per property and Monday-start billing week. VP²E has no separate reconcile control: its line is added only when a billable Weekly Standard or weekly contract-obligation task for that property and week is reconciled. Charges use the existing invoice workflow and are retained as invoice line-item snapshots.

## Foul Weather Fee

Run `supabase_setup_foul_weather_fee.sql` after the invoice, role-based access, SDS, and VP²E billing migrations before deploying the matching frontend. Admins and managers can mark completed Guest Ready pool tasks in the task editor; the selection saves immediately and is locked once the task is on a finalized invoice. A marked task adds a separate $20 Foul Weather Fee immediately after its billable Guest Ready invoice line. Included/no-charge Guest Ready visits do not incur the fee, and staff cannot change the selection. If a selection changes after a draft was created, regenerate the draft before finalizing it.

On macOS, run `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/foul_weather_fee.test.js` from the repository root for the focused invoice-line test. The migration and role/finalization workflows must also be tested against a staging Supabase database.

## Heavy Debris Fee

Run `supabase_setup_heavy_debris_fee.sql` after `supabase_setup_foul_weather_fee.sql` before deploying the matching frontend. Admins and managers can select a Heavy Debris Fee in the editor for a completed Guest Ready pool task. The amount defaults to $20.00 and can be adjusted from $20.00 to $50.00; changes save immediately and are locked after invoice finalization. The fee applies only when the Guest Ready task is billable and appears as a separate property-labeled invoice line. When both fees apply, their order is Guest Ready, Foul Weather Fee, then Heavy Debris Fee. Regenerate drafts after changing a selection or amount.

The focused JavaScriptCore test above also covers heavy debris fees. Test both migrations, permissions, invoice finalization, and reporting against a staging Supabase database before deployment.

## Existing Task Branch Editing

Run `supabase_setup_task_service_branch_editing.sql` in the Supabase SQL Editor before deploying existing-task branch editing. Its role-checked Admin/Manager RPC updates only `cleaning_tasks.service_branch` on the existing task ID. Completed, historical, reconciled, and invoice-linked tasks remain locked; Staff receives no branch-edit control or write permission.

Run `supabase_setup_task_carry_forward.sql` in the Supabase SQL Editor before deploying automatic unfinished-task carry-forward. It adds permanent original-date/count/timestamp audit fields and an authenticated role-checked RPC that moves eligible unfinished rows to the current `America/New_York` business date without inserting, deleting, or changing task IDs. Completed, cancelled, reconciled, invoice-linked, and all Guest Ready/check-in-sensitive tasks are excluded. Guest Ready tasks remain historical for manual review because the iCal workflow owns their reservation-derived dates. Carried rows are marked modified so the existing iCal workflow cannot suppress or reposition them; the dedicated carry-forward audit fields distinguish that system action from an ordinary manual reschedule.

## Pipeline Setup

Run `supabase_setup_pipeline_jobs.sql` in the Supabase SQL Editor after the role-based access and cleaning-task parts/labor migrations. Pipeline is Admin-only: its table RLS policy and scheduling RPC both require `is_active_app_admin()`, and no Pipeline columns are added to Staff or Manager views.

Approving a Pipeline job calls `approve_and_schedule_pipeline_job`, which atomically creates one normal `cleaning_tasks` row and stores its ID in `pipeline_jobs.scheduled_task_id`. The potential revenue becomes the task `charge`; projected parts and paid labor become the normal task cost fields. Pipeline records themselves are not read by invoice, forecast, or P&L reporting code.

For customer approval links, run `supabase_setup_pipeline_approvals.sql` after `supabase_setup_pipeline_jobs.sql`. Approval records contain an immutable customer-facing snapshot and a SHA-256 token hash; the raw 256-bit token is returned once to Admin and cached only in that Admin browser for copying. Public visitors use `proposal.html?token=...`, which calls narrow anonymous RPCs that return only the snapshot fields and accept a write-once Approved or Declined response. Links expire after 30 days and can be revoked by Admin.

The standalone proposal page can be exercised locally after the SQL migration is applied. A customer-accessible URL requires deploying `proposal.html`, `proposal.js`, and `proposal.css` to the same Netlify site as the application. No Supabase Edge Function is required.

## Status

Active Development
