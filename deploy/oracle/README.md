# Host the API free on Oracle Cloud (Always Free)

Runs the API, Redis and an HTTPS proxy (Caddy) on one VM with Docker.

## 1. Create the VM
1. Sign up at cloud.oracle.com (a card is needed for verification; it is not charged on Always Free).
2. Compute -> Instances -> Create. Image: **Ubuntu 22.04**. Shape: **Ampere (VM.Standard.A1.Flex)**,
   2 OCPU / 12 GB RAM (inside the free allowance). Do NOT pick the 1 GB micro shape; the build runs out of memory.
3. Add your SSH public key, create it, and note the **public IP**.
4. Networking -> your VCN -> Security List -> add Ingress rules for TCP **80** and **443** from 0.0.0.0/0.

## 2. Get a free hostname
Make an account at duckdns.org, create a subdomain (e.g. `closebuy-api`), and set its IP to the VM's public IP.
Your API URL is then `https://closebuy-api.duckdns.org`.

## 3. Prepare the VM
```
ssh ubuntu@<public-ip>
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu && exit        # log back in afterwards
# open the OS firewall too (Oracle images block 80/443 by default)
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo sh -c 'iptables-save > /etc/iptables/rules.v4' || true
```

## 4. Deploy
```
git clone https://github.com/scotty126/CloseBuy.git
cd CloseBuy/deploy/oracle
cp .env.example .env && nano .env      # fill in every value
docker compose up -d --build           # first build takes several minutes
docker compose logs -f api             # wait for it to listen
```
Migrations run automatically on every start.

Check it: open `https://<your-hostname>/health` (or any public route such as `/vendors`) in a browser.

## 5. Point the apps at it
- Cloudflare projects: set the build variable `NEXT_PUBLIC_API_URL` to the API URL and retry the build.
- Google Cloud Console: add `<API URL>/auth/oauth/google/callback` as an authorised redirect URI.

## Updating later
```
cd CloseBuy && git pull && cd deploy/oracle && docker compose up -d --build
```
