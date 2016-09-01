var app = require('express')();
var fs = require('fs');
var http = require('http').Server(app);
var https = require('https');
var io = require('socket.io')(http);
var OAuth = require('oauth').OAuth;
var open = require('opener');
var querystring = require('querystring');
var read = require('./util/read_relative.js');
var Twitter = require('twitter');
var url = require('url');

var PORT = 12345;

var secrets = read.json('config/secrets.json');
var oauth = new OAuth(
	'https://api.twitter.com/oauth/request_token',
	'https://api.twitter.com/oauth/access_token',
	secrets.consumer_key,
	secrets.consumer_secret,
	'1.0A',
	null,
	'HMAC-SHA1');

app.post('/', (request, response) => {

	var body = [];

	request.on('data', (data) => {

		body.push(data);

	});

	request.on('end', () => {

		Promise.resolve(querystring.parse(body.join('')))
			.then(getUserID)
			.then(getPlaylistID)
			.then(openStream)
			.then((args) => {

				openSocket(args);

				response.end();

			}).catch((err) => {

				response.writeHead(500);

				response.end(JSON.stringify(err, null, 2));

			});

	});

	request.on('error', (err) => {

		response.writeHead(500);

		response.end(JSON.stringify(err, null, 2));

	});

});

app.post('/prompt', (request, response) => {

	var body = [];

	request.on('data', (data) => {

		body.push(data);

	});

	request.on('end', () => {

		var query = querystring.parse(body.join(''));

		var spotify_access_token = query.access_token;

		var twitter_access_token = query.state.split('%2C')[0];

		var twitter_access_token_secret = query.state.split('%2C')[1];

		response.end(read('pages/prompt.html')
			.replace('<<spotify_access_token>>', spotify_access_token)
			.replace('<<twitter_access_token>>', twitter_access_token)
			.replace('<<twitter_access_token_secret>>', twitter_access_token_secret));

	});

	request.on('error', (err) => {

		response.writeHead(500);

		response.end(JSON.stringify(err, null, 2));

	});	

});

app.get('/return-from-spotify', (request, response) => {

	fs.createReadStream('pages/return-from-spotify.html').pipe(response);

});

app.get('/return-from-twitter', (request, response) => {

	var query = querystring.parse(url.parse(request.url).query);

	oauth.getOAuthAccessToken(query.oauth_token, null, query.oauth_verifier, (err, access_token, access_token_secret, results) => {

		if (err) {

			response.writeHead(403);

			response.end(JSON.stringify(err));

		} else {

			response.writeHead(301, {
				Location: 'http://dj-hashtag.brettbeatty.com/sign-into-spotify?access_token=' + access_token + '&access_token_secret=' + access_token_secret
			});
			
			response.end();

		}

	});

});

app.get('/sign-into-spotify', (request, response) => {

	var query = querystring.parse(url.parse(request.url).query);

	response.writeHead(200);

	response.end(read('pages/sign-into-spotify.html').replace('<<twitter_access_token>>', query.access_token).replace('<<twitter_access_token_secret>>', query.access_token_secret));

});

app.get('/sign-into-twitter', (request, response) => {

	oauth.getOAuthRequestToken({
		callback_url: 'http://dj-hashtag.brettbeatty.com/return-from-twitter'
	}, (err, token, token_secret, query) => {

		if (err) {

			response.writeHead(403);

			response.end(err.toString());

		} else {

			response.writeHead(200);

			response.end(read('pages/sign-into-twitter.html')
				.replace('<<oauth_token>>', token));

		}

	});

});

app.get('/start', (request, response) => {

});

app.listen(PORT, () => {

	console.log("Now listening on port %d.", PORT);

});

function getPlaylistID(args) {

	return new Promise((resolve, reject) => {

		https.request({
			hostname: 'api.spotify.com',
			path: '/v1/users/' + args.user_id + '/playlists?limit=50',
			headers: {
				Authorization: 'Bearer ' + args.spotify_access_token
			},
			method: 'GET'
		}, (response) => {

			var body = [];
			var playlists;

			response.on('data', (data) => {

				body.push(data);

			});

			response.on('end', () => {

				if (body.length == 0) reject(new Error('Could not get a list of playlists for user ' + args.user_id));

				else {

					playlists = JSON.parse(body.join('')).items;

					for (i = 0; i < playlists.length; i++) {

						if (playlists[i].name = args.playlist) {

							args.playlist_id = playlists[i].id;

							resolve(args);

							return null;

						}

					}

					reject(new Error('Could not find playlist ' + args.playlist + ' for user ' + args.user_id));

				}

			});

			response.on('error', (err) => reject(err));

		}).end();

	});

}

function getUserID(args) {

	return new Promise((resolve, reject) => {

		https.request({
			hostname: 'api.spotify.com',
			path: '/v1/me',
			headers: {
				Authorization: 'Bearer ' + args.spotify_access_token
			},
			method: 'GET'
		}, (response) => {

			var body = [];

			response.on('data', (data) => body.push(data));

			response.on('end', () => {

				if (body.length == 0) reject(new Error("Found no user ID"));

				else {

					args.user_id = JSON.parse(body.join('')).id;

					resolve(args);

				} 

			});

			response.on('error', (err) => reject(err));

		}).end();

	});

}

function openSocket(args) {

	io.on('connection', (socket) => {

		socket.on('disconnect', () => {

			args.twitter_stream.destroy();

		});

	});

}

function processTweet(args) {

	var i = 0;
	var parts = args.tweet.split(' ');	

	while (i < parts.length) {

		if (parts[i][0] == '#') parts.splice(i, 1);

		else i++;

	}

	var query = encodeURIComponent(parts.join(' '));

	https.request({
		hostname: 'api.spotify.com',
		path: '/v1/search?type=track&limit=1&query=' + query,
		method: 'GET'
	}, (response) => {

		var body = [];

		response.on('data', (data) => {

			body.push(data);

		});

		response.on('end', () => {

			var uri = JSON.parse(body.join('')).tracks.items[0].uri;

			https.request({
				hostname: 'api.spotify.com',
				path: '/v1/users/' + args.user_id + '/playlists/' + args.playlist_id + '/tracks?uris=' + uri,
				headers: {
					Authorization: 'Bearer ' + args.spotify_access_token
				},
				method: 'POST'
			}, (response) => {

				var body = [];

				response.on('data', (data) => {

					body.push(data);

				});

				response.on('end', () => {

					console.log(body.join(''));

				});

				response.on('error', (err) => {

					console.error(JSON.stringify(err, null, 2));

				});

			}).end();

		});		

	}).end();

}

function openStream(args) {

	return new Promise((resolve, reject) => {

		var twitter = new Twitter({
			consumer_key: secrets.consumer_key,
			consumer_secret: secrets.consumer_secret,
			access_token_key: args.twitter_access_token,
			access_token_secret: args.twitter_access_token_secret
		});

		var stream = twitter.stream('statuses/filter', {
			track: '#' + args.hashtag
		});

		args.twitter_stream = stream;

		stream.on('data', (event) => {

			args.tweet = event.text;

			processTweet(args);

		});

		stream.on('error', (err) => {

			console.log(err);

		});

		resolve(args);

	});

}
