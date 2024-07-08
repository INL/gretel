First step, create a dockerfile that copies the entire tree. 
Based on python:buster

we install node 14, and run the following commands: 

bootstrap.py
yarn build
yarn django collectstatic --settings SETTINGS --pythonpath path/to/settings.py
(replaced path with backend/gretel/settings.py) ? 
removed --settings SETTINGS (is that an override?)


Didn't work this way
Needed to bypass some input asking in bootstrap.py

After this we get further. 
But still doesn't work.
Forgot to install the python dependencies

seems to succeed but outputs the following in the end:

```bash
# Almost ready to go! Just a couple more commands to run:
virtualenv .env --prompt=gretel5
source .env/bin/activate
yarn # runs install script
psql -f backend/create_db.sql
yarn django migrate
yarn django createsuperuser
git branch --track main origin/main
git flow init -d
yarn start
```