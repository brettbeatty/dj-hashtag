var fs = require('fs');

var BASE_PATH = __dirname + '/../';
var UTF_8 = 'utf8';

function read(filename) {

	return fs.readFileSync(BASE_PATH + filename, UTF_8);

}

function json(filename) {

	return JSON.parse(read(filename));

}

read.json = json;

module.exports = read;