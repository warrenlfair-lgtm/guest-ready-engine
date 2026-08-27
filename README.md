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

Before enabling role-based access, run the existing schema migrations used by the application, including the cleaning-task labor tracking, paid labor classification, chemical usage, invoice/expense, and Lawn Service migrations. Then run `supabase_setup_role_based_access.sql`, `supabase_fix_staff_operational_views.sql`, and `supabase_setup_manager_role.sql` manually in that order in the Supabase SQL Editor. Review the bootstrap email near the top of the role-based migration before running it; it currently preserves `warren.l.fair@gmail.com` as an active admin.

To add the first staff account:

1. Create or invite the user in Supabase Dashboard under Authentication > Users.
2. Sign in with an Admin account and open Settings > Authorized Users.
3. Set the user's role to Staff, leave Active enabled, and save.

Staff can use Pool Service and Lawn Service Today/Week operations, start and complete tasks, open checklists, and record chemical quantities. Financial tables remain protected by admin-only row-level security; staff reads use restricted views that omit financial columns, and staff writes use role-checked RPC functions.

Managers can use Pool Service and Lawn / Gen Labor Today, Week, and Properties views. The Properties view is limited to Current Month and Next Month. Manager reads use dedicated operational-only views, and task assignments, service levels, notes, starts, and completions use role-checked RPC functions. Manager views do not expose financial columns.

## Status

Active Development
