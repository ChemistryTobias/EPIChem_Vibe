"""Identity routes never expose credentials."""


def test_user_list_has_no_password_hashes(client):
    users = client.get("/api/v1/users").json()
    assert users and all("password_hash" not in u and "password" not in u for u in users)


def test_single_user_has_no_password_hash(client):
    user = client.get("/api/v1/users/tester").json()
    assert user["name"] == "tester" and "password_hash" not in user
