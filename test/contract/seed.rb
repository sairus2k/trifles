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
[ "Checking", "Savings" ].each do |name|
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
