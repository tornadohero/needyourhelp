# Permission Spec

## RBAC

| Role | User data | Provider review | Orders | Finance | Moderation | Rules |
|---|---|---|---|---|---|---|
| USER | own | no | own | own | report | read |
| PROVIDER | own | no | own provider orders | own earnings | report | read |
| MODERATOR | limited | no | read | no | yes | read |
| OPS | operational | yes | yes | limited | yes | read |
| FINANCE | limited | no | read | yes | no | read |
| ADMIN | broad | yes | yes | yes | yes | yes |

## Resource permissions

- Parent can CRUD own children.
- Provider can CRUD own profile/services.
- Provider cannot approve self.
- User can read public provider profiles.
- User can read only own private verification status.
- Admin can read verification documents only when required and access is audited.
- Finance cannot read raw identity documents unless explicitly granted.
- Moderator sees minimum data needed for a report.
- No role can export all child data by default.

## Field-level privacy

Public provider:
- public_name: yes
- avatar: based on visibility
- school/organization: policy controlled
- exact phone: no
- identity document: no
- private notes: no
- verification status: yes, as badge
- rating: yes

Child:
- nickname/grade/learning goals: only guardian and authorized workflow participants
- exact address: never public
- identity document: never public
- phone: never public by default
