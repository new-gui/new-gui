this bot is used to replace pmans posting spree ads across dank servers, it create a channel and choose the right range ping role deping on interact guild member count (which is wrong)

# Setup:

in setup, the roles you mention are the roles used to be pinged in the channels created in ur server

# Spree post:

used to make a spree ad with other servers to post it on all servers with a valid setup

# What you should do to complete the bot:

1) change inteactionrangekey to totalmembersCount, totalmembersCount is the sum of all guild members joining the spree, make sure to make the bot use the matching range key for pings that are pinged in other servers
    
2) make a 12h cool down for all servers that joined spree after succesful post

3) [opptional] change text confirmation -> button confirmation

4) [ semi opptional but better] in setup, add 2 more fields, logging-channel and confirm-channel

5) [semi opptioanl but important] replace dm confrim request from guild owner -> confirm-channel

6) [semi opptional] in logging-channel, log the following: {1} who posted the ad {2} servers associated {3} confirm by who (your ad) {4} content(opptional)

7) [important] in your support server, log all ads posted with all info possible

8) [opptional] make the bot to check all setup datas every while, and make setup to have limits on some servers like if your server has 500 members, you must have 3 range roles at least,

9) [opptional] servers joining spree with >500 members and same guild owner must be refused.
