(function (window) {

    var WebGLProgram = function (gl, vertexSource, fragmentSource) {

        var _collect = function (source, prefix, collection) {
            var r = new RegExp('\\b' + prefix + ' \\w+ (\\w+)', 'ig');
            source.replace(r, function (match, name) {
                collection[name] = 0;
                return match;
            });
        };

        var _compile = function (gl, source, type) {
            var shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);

            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.log(gl.getShaderInfoLog(shader));
                return null;
            }
            return shader;
        };


        this.uniform = {};
        this.attribute = {};

        var _vsh = _compile(gl, vertexSource, gl.VERTEX_SHADER);
        var _fsh = _compile(gl, fragmentSource, gl.FRAGMENT_SHADER);

        this.id = gl.createProgram();
        gl.attachShader(this.id, _vsh);
        gl.attachShader(this.id, _fsh);
        gl.linkProgram(this.id);

        if (!gl.getProgramParameter(this.id, gl.LINK_STATUS)) {
            console.log(gl.getProgramInfoLog(this.id));
        }

        gl.useProgram(this.id);

        // Получение атрибутов
        _collect(vertexSource, 'attribute', this.attribute);
        for (var a in this.attribute) {
            this.attribute[a] = gl.getAttribLocation(this.id, a);
        }

        // Получение униформ
        _collect(vertexSource, 'uniform', this.uniform);
        _collect(fragmentSource, 'uniform', this.uniform);
        for (var u in this.uniform) {
            this.uniform[u] = gl.getUniformLocation(this.id, u);
        }
    };


    var WebGLImageFilter = window.WebGLImageFilter = function () {
        var
            gl = null,
            _drawCount = 0,
            _sourceTexture = null,
            _lastInChain = false,
            _currentFramebufferIndex = -1,
            _tempFramebuffers = [null, null],
            _filterChain = [],
            _width = -1,
            _height = -1,
            _vertexBuffer = null,
            _currentProgram = null,
            _canvas = document.createElement('canvas');

        var gl = _canvas.getContext("webgl") || _canvas.getContext("experimental-webgl");
        if (!gl) {
            throw "Couldn't get WebGL context";
        }


        this.addFilter = function (name) {
            var args = Array.prototype.slice.call(arguments, 1);
            var filter = _filter[name];

            _filterChain.push({ func: filter, args: args });
        };

        this.reset = function () {
            _filterChain = [];
        };

        this.apply = function (image) {
            _resize(image.width, image.height);
            _drawCount = 0;

            // Вывод изображения при отсутствии фильтров
            if (_filterChain.length == 0) {
                var program = _compileShader(SHADER.FRAGMENT_IDENTITY);
                _draw();
            }

            // Создание матрицы изображения для введённой картинки
            _sourceTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, _sourceTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

            for (var i = 0; i < _filterChain.length; i++) {
                _lastInChain = (i == _filterChain.length - 1);
                var f = _filterChain[i];

                f.func.apply(this, f.args || []);
            }

            return _canvas;
        };

        var _resize = function (width, height) {
            // Возвращает пустое значение, если картинка квадратная
            if (width == _width && height == _height) { return; }


            _canvas.width = _width = width;
            _canvas.height = _height = height;

            // Create the context if we don't have it yet
            if (!_vertexBuffer) {
                // Создаёт буффер для треугольника
                var vertices = new Float32Array([
                    -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0,
                    -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0
                ]);
                _vertexBuffer = gl.createBuffer(),
                gl.bindBuffer(gl.ARRAY_BUFFER, _vertexBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

                // загрузка текстур

                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            }

            gl.viewport(0, 0, _width, _height);

            // Удаление из буферов старых данных о матрицк
            _tempFramebuffers = [null, null];
        };

        var _getTempFramebuffer = function (index) {
            _tempFramebuffers[index] =
                _tempFramebuffers[index] ||
                _createFramebufferTexture(_width, _height);

            return _tempFramebuffers[index];
        };

        var _createFramebufferTexture = function (width, height) {
            var fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

            var renderbuffer = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);

            var texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            return { fbo: fbo, texture: texture };
        };

        var _draw = function (flags) {
            var source = null,
                target = null,
                flipY = false;

            // Установка источника
            if (_drawCount == 0) {
                // Первый вызов - использование нарисованной текстуры
                source = _sourceTexture;
            }
            else {
                // Все последующие вызовы draw используют временный буфер, к которому последний раз обращались
                source = _getTempFramebuffer(_currentFramebufferIndex).texture;
            }
            _drawCount++;


            // Установка цели
            if (_lastInChain && !(flags & DRAW.INTERMEDIATE)) {
                // Последний выбранный фильтр выводится в канвас
                // тееперь мы можем переворачивать изображение
                target = null;
                flipY = _drawCount % 2 == 0;
            }
            else {
                // Промежуточный вызов метода draw - временный буфер
                _currentFramebufferIndex = (_currentFramebufferIndex + 1) % 2;
                target = _getTempFramebuffer(_currentFramebufferIndex).fbo;
            }

            // Соединяем источник и цель на основании матрицы
            gl.bindTexture(gl.TEXTURE_2D, source);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target);

            gl.uniform1f(_currentProgram.uniform.flipY, (flipY ? -1 : 1));
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        };

        var _compileShader = function (fragmentSource) {
            if (fragmentSource.__program) {
                _currentProgram = fragmentSource.__program;
                gl.useProgram(_currentProgram.id);
                return _currentProgram;
            }

            // компилируем шейдеры
            _currentProgram = new WebGLProgram(gl, SHADER.VERTEX_IDENTITY, fragmentSource);

            var floatSize = Float32Array.BYTES_PER_ELEMENT;
            var vertSize = 4 * floatSize;
            gl.enableVertexAttribArray(_currentProgram.attribute.pos);
            gl.vertexAttribPointer(_currentProgram.attribute.pos, 2, gl.FLOAT, false, vertSize, 0 * floatSize);
            gl.enableVertexAttribArray(_currentProgram.attribute.uv);
            gl.vertexAttribPointer(_currentProgram.attribute.uv, 2, gl.FLOAT, false, vertSize, 2 * floatSize);

            fragmentSource.__program = _currentProgram;
            return _currentProgram;
        };


        var DRAW = { INTERMEDIATE: 1 };

        var SHADER = {};
        SHADER.VERTEX_IDENTITY = [
            'precision highp float;',
            'attribute vec2 pos;',
            'attribute vec2 uv;',
            'varying vec2 vUv;',
            'uniform float flipY;',

            'void main(void) {',
                'vUv = uv;',
                'gl_Position = vec4(pos.x, pos.y*flipY, 0.0, 1.);',
            '}'
        ].join('\n');

        SHADER.FRAGMENT_IDENTITY = [
            'precision highp float;',
            'varying vec2 vUv;',
            'uniform sampler2D texture;',

            'void main(void) {',
                'gl_FragColor = texture2D(texture, vUv);',
            '}',
        ].join('\n');


        var _filter = {};



        // ----------------------------------------------------------------------------
        // Матрицы фильтров

        _filter.colorMatrix = function (matrix) {
            // Создаём массив Float 32 И нормализуем смещение
            var m = new Float32Array(matrix);
            m[4] /= 255;
            m[9] /= 255;
            m[14] /= 255;
            m[19] /= 255;


            var shader = (1 == m[18] && 0 == m[3] && 0 == m[8] && 0 == m[13] && 0 == m[15] && 0 == m[16] && 0 == m[17] && 0 == m[19])
                ? _filter.colorMatrix.SHADER.WITHOUT_ALPHA
                : _filter.colorMatrix.SHADER.WITH_ALPHA;

            var program = _compileShader(shader);
            gl.uniform1fv(program.uniform.m, m);
            _draw();
        };

        _filter.colorMatrix.SHADER = {};
        _filter.colorMatrix.SHADER.WITH_ALPHA = [
            'precision highp float;',
            'varying vec2 vUv;',
            'uniform sampler2D texture;',
            'uniform float m[20];',

            'void main(void) {',
                'vec4 c = texture2D(texture, vUv);',
                'gl_FragColor.r = m[0] * c.r + m[1] * c.g + m[2] * c.b + m[3] * c.a + m[4];',
                'gl_FragColor.g = m[5] * c.r + m[6] * c.g + m[7] * c.b + m[8] * c.a + m[9];',
                'gl_FragColor.b = m[10] * c.r + m[11] * c.g + m[12] * c.b + m[13] * c.a + m[14];',
                'gl_FragColor.a = m[15] * c.r + m[16] * c.g + m[17] * c.b + m[18] * c.a + m[19];',
            '}',
        ].join('\n');
        _filter.colorMatrix.SHADER.WITHOUT_ALPHA = [
            'precision highp float;',
            'varying vec2 vUv;',
            'uniform sampler2D texture;',
            'uniform float m[20];',

            'void main(void) {',
                'vec4 c = texture2D(texture, vUv);',
                'gl_FragColor.r = m[0] * c.r + m[1] * c.g + m[2] * c.b + m[4];',
                'gl_FragColor.g = m[5] * c.r + m[6] * c.g + m[7] * c.b + m[9];',
                'gl_FragColor.b = m[10] * c.r + m[11] * c.g + m[12] * c.b + m[14];',
                'gl_FragColor.a = c.a;',
            '}',
        ].join('\n');

        // Фильтр насыщение
        _filter.saturation = function (amount) {
            var x = (amount || 0) * 2 / 3 + 1;
            var y = ((x - 1) * -0.5);
            _filter.colorMatrix([
                x, y, y, 0, 0,
                y, x, y, 0, 0,
                y, y, x, 0, 0,
                0, 0, 0, 1, 0
            ]);
        };


        // Негатив
        _filter.negativeon = function (amount) {
            var v = (amount || 0) + 1;
            var o = -128 * (v - 1);

            _filter.colorMatrix([
                v, 0, 0, 0, o,
                0, v, 0, 0, o,
                0, 0, v, 0, o,
                0, 0, 0, 1, 0
            ]);
        };

        _filter.negative = function () {
            _filter.negativeon(-2);
        };

        // Фильтр смещения по RGB
        _filter.hue = function (rotation) {
            rotation = (rotation || 0) / 180 * Math.PI;
            var cos = Math.cos(rotation),
                sin = Math.sin(rotation),
                lumR = 0.213,
                lumG = 0.715,
                lumB = 0.072;

            _filter.colorMatrix([
                    lumR + cos * (1 - lumR) + sin * (-lumR), lumG + cos * (-lumG) + sin * (-lumG), lumB + cos * (-lumB) + sin * (1 - lumB), 0, 0,
                    lumR + cos * (-lumR) + sin * (0.143), lumG + cos * (1 - lumG) + sin * (0.140), lumB + cos * (-lumB) + sin * (-0.283), 0, 0,
                    lumR + cos * (-lumR) + sin * (-(1 - lumR)), lumG + cos * (-lumG) + sin * (lumG), lumB + cos * (1 - lumB) + sin * (lumB), 0, 0,
                    0, 0, 0, 1, 0
            ]);
        };

        _filter.desaturateLuminance = function () {
            _filter.colorMatrix([
                0.2764723, 0.9297080, 0.0938197, 0, -37.1,
                0.2764723, 0.9297080, 0.0938197, 0, -37.1,
                0.2764723, 0.9297080, 0.0938197, 0, -37.1,
                0, 0, 0, 1, 0
            ]);
        };

        // Сепия
        _filter.sepia = function () {
            _filter.colorMatrix([
                0.393, 0.7689999, 0.18899999, 0, 0,
                0.349, 0.6859999, 0.16799999, 0, 0,
                0.272, 0.5339999, 0.13099999, 0, 0,
                0, 0, 0, 1, 0
            ]);
        };

        // Кодакхром
        _filter.kodachrome = function () {
            _filter.colorMatrix([
                1.1285582396593525, -0.3967382283601348, -0.03992559172921793, 0, 63.72958762196502,
                -0.16404339962244616, 1.0835251566291304, -0.05498805115633132, 0, 24.732407896706203,
                -0.16786010706155763, -0.5603416277695248, 1.6014850761964943, 0, 35.62982807460946,
                0, 0, 0, 1, 0
            ]);
        };



        // ----------------------------------------------------------------------------
        // Convolution Filter

        _filter.convolution = function (matrix) {
            var m = new Float32Array(matrix);
            var pixelSizeX = 1 / _width;
            var pixelSizeY = 1 / _height;

            var program = _compileShader(_filter.convolution.SHADER);
            gl.uniform1fv(program.uniform.m, m);
            gl.uniform2f(program.uniform.px, pixelSizeX, pixelSizeY);
            _draw();
        };

        _filter.convolution.SHADER = [
            'precision highp float;',
            'varying vec2 vUv;',
            'uniform sampler2D texture;',
            'uniform vec2 px;',
            'uniform float m[9];',

            'void main(void) {',
                'vec4 c11 = texture2D(texture, vUv - px);', // top left
                'vec4 c12 = texture2D(texture, vec2(vUv.x, vUv.y - px.y));', // top center
                'vec4 c13 = texture2D(texture, vec2(vUv.x + px.x, vUv.y - px.y));', // top right

                'vec4 c21 = texture2D(texture, vec2(vUv.x - px.x, vUv.y) );', // mid left
                'vec4 c22 = texture2D(texture, vUv);', // mid center
                'vec4 c23 = texture2D(texture, vec2(vUv.x + px.x, vUv.y) );', // mid right

                'vec4 c31 = texture2D(texture, vec2(vUv.x - px.x, vUv.y + px.y) );', // bottom left
                'vec4 c32 = texture2D(texture, vec2(vUv.x, vUv.y + px.y) );', // bottom center
                'vec4 c33 = texture2D(texture, vUv + px );', // bottom right

                'gl_FragColor = ',
                    'c11 * m[0] + c12 * m[1] + c22 * m[2] +',
                    'c21 * m[3] + c22 * m[4] + c23 * m[5] +',
                    'c31 * m[6] + c32 * m[7] + c33 * m[8];',
                'gl_FragColor.a = c22.a;',
            '}',
        ].join('\n');


        _filter.detectEdges = function () {
            _filter.convolution.call(this, [
                0, 1, 0,
                1 - 4, 1,
                0, 1, 0
            ]);
        };

        _filter.sharpen = function (amount) {
            var a = amount || 1;
            _filter.convolution.call(this, [
                0, -1 * a, 0,
                -1 * a, 1 + 4 * a, -1 * a,
                0, -1 * a, 0
            ]);
        };

        _filter.emboss = function (size) {
            var s = size || 1;
            _filter.convolution.call(this, [
                -2 * s, -1 * s, 0,
                -1 * s, 1, 1 * s,
                0, 1 * s, 2 * s
            ]);
        };


        // ----------------------------------------------------------------------------

    };

})(window);
