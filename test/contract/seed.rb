# The API cannot create a user, an API key, an account (no POST /accounts) or a merchant
# (POST /merchants is a CSV import), so the contract suite seeds them with models, as Sure's
# Demo::Generator does. Run once on a fresh database by global-setup.ts.

family = Family.create!(
  name: "Contract",
  currency: "USD",
  locale: "en",
  country: "US",
  timezone: "UTC",
  date_format: "%Y-%m-%d"
)

user = family.users.create!(
  email: "contract@example.com",
  first_name: "Contract",
  last_name: "Suite",
  role: "admin",
  password: "Password1!",
  onboarded_at: Time.current
)

# ApiKey#set_display_key stores `key` as given, so the suite knows both keys up front.
user.api_keys.create!(name: "read_write", key: ENV.fetch("SURE_READ_WRITE_KEY"), scopes: [ "read_write" ], source: "web")
user.api_keys.create!(name: "read", key: ENV.fetch("SURE_READ_KEY"), scopes: [ "read" ], source: "web")

# An explicit owner: create looks the account up with writable_by(user) and answers 500 otherwise.
# Latency is written by the latency test only, so no other test's sync moves its balance.
[ "Checking", "Savings", "Latency" ].each do |name|
  Account.create_and_sync({
    family: family,
    owner: user,
    name: name,
    balance: 1000,
    currency: "USD",
    accountable_type: "Depository",
    accountable_attributes: {}
  })
end

family.categories.create!(name: "Groceries", color: "#10b981")
family.merchants.create!(name: "Corner Shop")

# Another member's account the key's user cannot reach (TASK-19). With the family's default
# sharing, create_and_sync shares it with every other member, so the share is removed. The id is
# fixed because the key cannot list the account.
other = family.users.create!(
  email: "other@example.com",
  first_name: "Other",
  last_name: "Member",
  role: "member",
  password: "Password1!",
  onboarded_at: Time.current
)
Account.create_and_sync({
  id: ENV.fetch("SURE_UNSHARED_ACCOUNT_ID"),
  family: family,
  owner: other,
  name: "Unshared",
  balance: 1000,
  currency: "USD",
  accountable_type: "Depository",
  accountable_attributes: {}
})
AccountShare.where(account_id: ENV.fetch("SURE_UNSHARED_ACCOUNT_ID")).delete_all

# Accounts of the other member the key's user can read (TASK-24). create_and_sync shares each one
# with the other members as read_write; Sure writes only to an owned account or a full_control
# share, so two of the shares are changed. The key lists them, so the suite finds them by name.
{
  "Shared read_write" => nil,
  "Shared read_only" => "read_only",
  "Shared full_control" => "full_control"
}.each do |name, permission|
  account = Account.create_and_sync({
    family: family,
    owner: other,
    name: name,
    balance: 1000,
    currency: "USD",
    accountable_type: "Depository",
    accountable_attributes: {}
  })
  AccountShare.where(account: account, user: user).update_all(permission: permission) if permission
end

# One account of each other type, so the suite sees every `account_type` the Balances screen
# groups by (TASK-29).
%w[Investment Crypto Property Vehicle OtherAsset CreditCard Loan OtherLiability].each do |type|
  Account.create_and_sync({
    family: family,
    owner: user,
    name: type,
    balance: 1000,
    currency: "USD",
    accountable_type: type,
    accountable_attributes: {}
  })
end
