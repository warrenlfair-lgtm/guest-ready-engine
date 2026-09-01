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

Staff can use Pool Service and Lawn Service Today/Week operations, start and complete tasks, open checklists, and record chemical quantities. Financial tables remain protected by admin-only row-level security; staff reads use restricted views that omit financial columns, and staff writes use role-checked RPC functions.

Managers can use Pool Service and Lawn / Gen Labor Today, Week, and Properties views. The Properties view is limited to Current Month and Next Month. Manager reads use dedicated operational-only views, and task assignments, service levels, notes, starts, completions, and completed-task reconciliation use role-checked RPC functions. Reconciliation eligibility is exposed only as boolean fields; configured charges and invoice data remain server-side, Manager views expose no financial columns, and Managers cannot access the Invoices page.

## Pipeline Setup

Run `supabase_setup_pipeline_jobs.sql` in the Supabase SQL Editor after the role-based access and cleaning-task parts/labor migrations. Pipeline is Admin-only: its table RLS policy and scheduling RPC both require `is_active_app_admin()`, and no Pipeline columns are added to Staff or Manager views.

Approving a Pipeline job calls `approve_and_schedule_pipeline_job`, which atomically creates one normal `cleaning_tasks` row and stores its ID in `pipeline_jobs.scheduled_task_id`. The potential revenue becomes the task `charge`; projected parts and paid labor become the normal task cost fields. Pipeline records themselves are not read by invoice, forecast, or P&L reporting code.

For customer approval links, run `supabase_setup_pipeline_approvals.sql` after `supabase_setup_pipeline_jobs.sql`. Approval records contain an immutable customer-facing snapshot and a SHA-256 token hash; the raw 256-bit token is returned once to Admin and cached only in that Admin browser for copying. Public visitors use `proposal.html?token=...`, which calls narrow anonymous RPCs that return only the snapshot fields and accept a write-once Approved or Declined response. Links expire after 30 days and can be revoked by Admin.

The standalone proposal page can be exercised locally after the SQL migration is applied. A customer-accessible URL requires deploying `proposal.html`, `proposal.js`, and `proposal.css` to the same Netlify site as the application. No Supabase Edge Function is required.

## Status

Active Development
