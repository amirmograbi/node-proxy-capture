var static = require('node-static');
var crypto = require('crypto');
var fs = require('fs');
var http = require('http');
var httpProxy = require('http-proxy');
var argv = require('optimist').argv;

var gw_domain = null;
var gw_port = null;
var base_url_path = null;
var exit_word = 'exit';
var CACHE_MAP_FILE_NAME = "cache.json";
_G_OUTPUT_FOLDER = "captured_files";
var LOCAL_DOMAIN = "localhost";
//var LOCAL_PORT_CACHED_FILE_REQUEST = 8002;
var LOCAL_PORT = argv.port || 8001;
var CACHE_FILE_PATH = _G_OUTPUT_FOLDER+'/'+CACHE_MAP_FILE_NAME;
var urlAggregator = {};//this will contain the url->file mapping

_G_isCachingMode = argv.cache;
var fileServer = null;
if (_G_isCachingMode){
	var cacheMapString = null;
	if (fs.existsSync(CACHE_FILE_PATH)){
		cacheMapString = fs.readFileSync(CACHE_FILE_PATH,'utf8');
		urlAggregator = JSON.parse(cacheMapString);
		console.log("succesfully loaded existing cache.");
	} else {
		console.log("starting new cache, cache file does not exist.");
	}
	fileServer = new static.Server("./"+_G_OUTPUT_FOLDER, { cache: false });
}

var SERVICE_DOC_FILENAME = {"name": "ServiceDocument", "ext": "xml"};
var METADATA_FILENAME = {"name": "Metadata", "ext": "xml"};

if (process.argv[2]!==undefined && process.argv[3]!==undefined && process.argv[4]!==undefined){	
	gw_domain = process.argv[2];
	gw_port = process.argv[3];
	base_url_path = process.argv[4];
} else {
	console.log("program exited");
	console.log("to run: node proxy.js <gw_domain> <gw_port> <base_url_path>");
	process.exit();
}
console.log("connecting to:"+gw_domain+':'+gw_port);
console.log("listening on port: "+LOCAL_PORT);
if (base_url_path){
	console.log("base url path provided: "+base_url_path);
} else {
	console.log("no base url path provided!");
}




if (!fs.existsSync(_G_OUTPUT_FOLDER)){
	try {
		fs.mkdir(_G_OUTPUT_FOLDER);
	} catch (err) {
		console.log("unable to create dir ",_G_OUTPUT_FOLDER);
	}
}

//this does not work on windows!
//process.on('SIGINT', function () {
//	console.log("got SIGINT");
//	process.exit();
//});

process.on('exit', function () {
	console.log("exited succesfully");
});

var resourceMap = {resources:[]};


_G_ADD_RESOURCE_ENTRY_TO_MAP = function(url,fileNameObj){
	//first get rid of path part of URL, if base url provided
	if (base_url_path) {
		url = url.substring(base_url_path.length);
	}
	if (fileNameObj === SERVICE_DOC_FILENAME){
		urlAggregator[url] = SERVICE_DOC_FILENAME;
	} else if (fileNameObj === METADATA_FILENAME){
		urlAggregator[url] = METADATA_FILENAME;
	}
	
	if (!urlAggregator.hasOwnProperty(url)){
		urlAggregator[url] = {"url": url, "resourcePath": fileNameObj.name,"ext":fileNameObj.ext};
		//fileName = fileName.substring(0,fileName.length - '.json'.length);
		resourceMap.resources.push({"url": url, "resourcePath": fileNameObj.name,"ext":fileNameObj.ext});
	}
}
/**
in case of miss it returns null, in case of hit it returns the body.
**/
_G_FETCH_FROM_CACHE = function (url){
	if (base_url_path) {
		url = url.substring(base_url_path.length);
	}
	if (urlAggregator[url]){
		return urlAggregator[url];
	} else {
		return null;
	}
}

function contentTypeToFileExtention(mimeType){
	var jpegRegExp = /jpeg/i;
	var xmlRegExp = /xml/i;
	var jsonRegExp = /json/i;
	if (jpegRegExp.test(mimeType)){ return "jpeg"};
	if (xmlRegExp.test(mimeType)){ return "xml"};
	return "json";//default is json
}
_globalFromURLtoFileName = function(url,headers){
	var max_length_of_url = 45;//this will be transformed to file name (without extention)
	if (base_url_path){
		url = url.substring(base_url_path.length);
		if (url.length===0){
			return SERVICE_DOC_FILENAME;
		}
		if (url === "$metadata"){
			return METADATA_FILENAME;
		}
	}
	if (url.length > max_length_of_url){
		var length_of_hash = 32;//this is the length of md5 hash, length of file name including hash should not be over max_length_of_url
		var x = max_length_of_url-length_of_hash; //x is where we seperate between the first part and the part to be hashed.
		var firstPart  = url.substring(0,x);
		var secondPart = url.substring(x);
		var secondPartHash = crypto.createHash('md5').update(secondPart).digest("hex");
		url = firstPart + secondPartHash;
	}
	var contentTypeVal = headers["content-type"] ? headers["content-type"] : headers["Content-Type"];
	//content-type:image/jpeg
	//Content-Type:application/xml
	//Content-Type:text/javascript
	//Content-Type:application/json;charset=utf-8
	var fileExt = contentTypeToFileExtention(contentTypeVal);
	return {"name": url.replace(/[^a-z0-9]/gi, '_'), "ext": fileExt};
 };

//Create a proxy server with custom application logic

httpProxy.createServer(function(req, res, proxy) {
	//
	// Put your custom server logic here
	//
	console.log("requested:  " + req.url);	
	var buffer = httpProxy.buffer(req);
	var domain = gw_domain;
	var port = gw_port;
	var acceptedURLRegexp = new RegExp('^'+base_url_path,"i");
	if (!acceptedURLRegexp.test(req.url)){
		//fileServer.serveFile('/not-found.html', 404, {}, req, res);
		//if anything is requested that is not under base url, answer with not found
		res.writeHead(404, {});
        res.end();
		return;
	}
	var cacheHitEntry = _G_FETCH_FROM_CACHE(req.url);
	
	if (_G_isCachingMode && cacheHitEntry){
	  //check for cache hit in case its enabled
		console.log("cache hit: " + req.url);
		var localFilePath = "/"+cacheHitEntry.name+"."+cacheHitEntry.ext;
		req.url = localFilePath;
		fileServer.serve(req, res);
  } else {
		proxy.proxyRequest(req, res, {
				host : domain,			
				port : port,
				buffer : buffer
		});
  }
	

	//res.on('close', function() {
	//	console.log("response close event emmited");
	//});

}).listen(LOCAL_PORT);

process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function (chunk) {
	if (chunk.substring(0, exit_word.length) === exit_word){
		var resourceMapText = JSON.stringify(resourceMap);
		fs.writeFileSync(_G_OUTPUT_FOLDER+'/resourceMap.json',resourceMapText,'utf8');
		var url2entryText = JSON.stringify(urlAggregator);
		fs.writeFileSync(CACHE_FILE_PATH,url2entryText,'utf8');
		process.exit();
	}
});

process.stdin.on('end', function () {
  process.stdout.write('end');
});

//http.createServer(
//		function(req, res) {
//			res.writeHead(200, {
//				'Content-Type' : 'text/plain'
//			});
//			res.write('request successfully proxied: ' + req.url + '\n'
//					+ JSON.stringify(req.headers, true, 2));
//			res.end();
//		}).listen(50009);