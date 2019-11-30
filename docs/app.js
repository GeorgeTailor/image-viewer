var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function set_custom_element_data(node, prop, value) {
        if (prop in node) {
            node[prop] = value;
        }
        else {
            attr(node, prop, value);
        }
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            $$.fragment && $$.fragment.p($$.ctx, $$.dirty);
            $$.dirty = [-1];
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, value = ret) => {
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, detail));
    }
    function append_dev(target, node) {
        dispatch_dev("SvelteDOMInsert", { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev("SvelteDOMInsert", { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev("SvelteDOMRemove", { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ["capture"] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev("SvelteDOMAddEventListener", { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev("SvelteDOMRemoveEventListener", { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev("SvelteDOMRemoveAttribute", { node, attribute });
        else
            dispatch_dev("SvelteDOMSetAttribute", { node, attribute, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        dispatch_dev("SvelteDOMSetData", { node: text, data });
        text.data = data;
    }
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error(`'target' is a required option`);
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn(`Component was already destroyed`); // eslint-disable-line no-console
            };
        }
    }

    /* src\App.svelte generated by Svelte v3.16.0 */

    const file = "src\\App.svelte";

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-1t2c4ox-style";
    	style.textContent = ".app.svelte-1t2c4ox{margin:20px}.image-thumbnails-wrapper.svelte-1t2c4ox{display:grid;grid-template-columns:repeat(auto-fill, minmax(100px, 185px));grid-template-rows:repeat(auto-fill, minmax(100px, 275px));grid-gap:30px;margin:10px}.image-thumbnails-wrapper.svelte-1t2c4ox .image-thumbnail.svelte-1t2c4ox{cursor:pointer;border:1px solid black;border-radius:5px;padding:10px}.image-thumbnails-wrapper.svelte-1t2c4ox .image-thumbnail img.svelte-1t2c4ox{width:150px;height:150px}.image-thumbnails-wrapper.svelte-1t2c4ox .image-thumbnail p.svelte-1t2c4ox{text-align:center}.image-thumbnails-wrapper.svelte-1t2c4ox .image-thumbnail zoo-button.svelte-1t2c4ox{height:45px;display:block}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXBwLnN2ZWx0ZSIsInNvdXJjZXMiOlsiQXBwLnN2ZWx0ZSJdLCJzb3VyY2VzQ29udGVudCI6WyI8ZGl2IGNsYXNzPVwiYXBwXCI+XHJcblx0PGgyPkltYWdlIHZpZXdlcjwvaDI+XHJcblx0PGRpdiBzdHlsZT1cIndpZHRoOiAyNTBweDtcIj5cclxuXHRcdDx6b28taW5wdXQgbGFiZWx0ZXh0PVwiQ2hvb3NlIGltYWdlcyB0byB1cGxvYWRcIj5cclxuXHRcdFx0PGlucHV0IHNsb3Q9XCJpbnB1dGVsZW1lbnRcIiB0eXBlPVwiZmlsZVwiIG11bHRpcGxlIGFjY2VwdD1cIi5qcGcsIC5qcGVnLCAucG5nXCIgb246Y2hhbmdlPVwie2UgPT4gaGFuZGxlRmlsZVVwbG9hZChlKX1cIiBiaW5kOnRoaXM9e19pbnB1dH0vPlxyXG5cdFx0PC96b28taW5wdXQ+XHJcblx0PC9kaXY+XHJcblx0PGRpdiBjbGFzcz1cImltYWdlLXRodW1ibmFpbHMtd3JhcHBlclwiPlxyXG5cdFx0eyNlYWNoIGltYWdlcyBhcyBpbWFnZSwgaX1cclxuXHRcdFx0PGRpdiBjbGFzcz1cImltYWdlLXRodW1ibmFpbFwiPlxyXG5cdFx0XHRcdDxpbWcgc3JjPXtpbWFnZS5kYXRhfSBhbHQ9XCJpbWFnZVwiIG9uOmxvYWQ9XCJ7ZnVuY3Rpb24oKSB7d2luZG93LlVSTC5yZXZva2VPYmplY3RVUkwodGhpcy5zcmMpfX1cIi8+XHJcblx0XHRcdFx0PHA+e2ltYWdlLm5hbWV9PC9wPlxyXG5cdFx0XHRcdDx6b28tYnV0dG9uIG9uOmNsaWNrPVwieygpID0+IHJlbW92ZUltYWdlKGkpfVwiPlxyXG5cdFx0XHRcdFx0PHNwYW4gc2xvdD1cImJ1dHRvbmNvbnRlbnRcIj5SZW1vdmUgaW1hZ2U8L3NwYW4+XHJcblx0XHRcdFx0PC96b28tYnV0dG9uPlxyXG5cdFx0XHQ8L2Rpdj5cclxuXHRcdHs6ZWxzZX1cclxuXHRcdFx0PHA+WW91IGhhdmVuJ3QgdXBsb2FkZWQgYW55IGltYWdlcyB5ZXQhPC9wPlxyXG5cdFx0ey9lYWNofVxyXG5cdDwvZGl2PlxyXG48L2Rpdj5cclxuXHJcbjxzdHlsZSB0eXBlPVwidGV4dC9zY3NzXCI+LmFwcCB7XG4gIG1hcmdpbjogMjBweDsgfVxuXG4uaW1hZ2UtdGh1bWJuYWlscy13cmFwcGVyIHtcbiAgZGlzcGxheTogZ3JpZDtcbiAgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiByZXBlYXQoYXV0by1maWxsLCBtaW5tYXgoMTAwcHgsIDE4NXB4KSk7XG4gIGdyaWQtdGVtcGxhdGUtcm93czogcmVwZWF0KGF1dG8tZmlsbCwgbWlubWF4KDEwMHB4LCAyNzVweCkpO1xuICBncmlkLWdhcDogMzBweDtcbiAgbWFyZ2luOiAxMHB4OyB9XG4gIC5pbWFnZS10aHVtYm5haWxzLXdyYXBwZXIgLmltYWdlLXRodW1ibmFpbCB7XG4gICAgY3Vyc29yOiBwb2ludGVyO1xuICAgIGJvcmRlcjogMXB4IHNvbGlkIGJsYWNrO1xuICAgIGJvcmRlci1yYWRpdXM6IDVweDtcbiAgICBwYWRkaW5nOiAxMHB4OyB9XG4gICAgLmltYWdlLXRodW1ibmFpbHMtd3JhcHBlciAuaW1hZ2UtdGh1bWJuYWlsIGltZyB7XG4gICAgICB3aWR0aDogMTUwcHg7XG4gICAgICBoZWlnaHQ6IDE1MHB4OyB9XG4gICAgLmltYWdlLXRodW1ibmFpbHMtd3JhcHBlciAuaW1hZ2UtdGh1bWJuYWlsIHAge1xuICAgICAgdGV4dC1hbGlnbjogY2VudGVyOyB9XG4gICAgLmltYWdlLXRodW1ibmFpbHMtd3JhcHBlciAuaW1hZ2UtdGh1bWJuYWlsIHpvby1idXR0b24ge1xuICAgICAgaGVpZ2h0OiA0NXB4O1xuICAgICAgZGlzcGxheTogYmxvY2s7IH1cblxuLyojIHNvdXJjZU1hcHBpbmdVUkw9eC5tYXAgKi88L3N0eWxlPlxyXG5cclxuPHNjcmlwdD5cclxuXHRsZXQgaW1hZ2VzID0gW107XHJcblx0bGV0IF9pbnB1dDtcclxuXHJcblx0Y29uc3QgaGFuZGxlRmlsZVVwbG9hZCA9IGUgPT4ge1xyXG5cdFx0Y29uc3QgdGVtcCA9IFsuLi5pbWFnZXNdO1xyXG5cdFx0Zm9yIChsZXQgaSA9IDA7IGkgPCBfaW5wdXQuZmlsZXMubGVuZ3RoOyBpKyspIHtcclxuXHRcdFx0Y29uc3QgZmlsZSA9IF9pbnB1dC5maWxlc1tpXTtcclxuXHRcdFx0dGVtcC5wdXNoKHtcclxuXHRcdFx0XHRkYXRhOiB3aW5kb3cuVVJMLmNyZWF0ZU9iamVjdFVSTChmaWxlKSxcclxuXHRcdFx0XHRuYW1lOiBmaWxlLm5hbWVcclxuXHRcdFx0fSk7XHJcblx0XHR9XHJcblx0XHRpbWFnZXMgPSB0ZW1wO1xyXG5cdFx0X2lucHV0LnZhbHVlID0gbnVsbDtcclxuXHR9XHJcblxyXG5cdGNvbnN0IHJlbW92ZUltYWdlID0gaWR4ID0+IHtcclxuXHRcdGltYWdlcyA9IGltYWdlcy5maWx0ZXIoKGltZywgaSkgPT4gaSAhPT0gaWR4KTtcclxuXHR9XHJcbjwvc2NyaXB0PiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFzQndCLElBQUksZUFBQyxDQUFDLEFBQzVCLE1BQU0sQ0FBRSxJQUFJLEFBQUUsQ0FBQyxBQUVqQix5QkFBeUIsZUFBQyxDQUFDLEFBQ3pCLE9BQU8sQ0FBRSxJQUFJLENBQ2IscUJBQXFCLENBQUUsT0FBTyxTQUFTLENBQUMsQ0FBQyxPQUFPLEtBQUssQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQzlELGtCQUFrQixDQUFFLE9BQU8sU0FBUyxDQUFDLENBQUMsT0FBTyxLQUFLLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUMzRCxRQUFRLENBQUUsSUFBSSxDQUNkLE1BQU0sQ0FBRSxJQUFJLEFBQUUsQ0FBQyxBQUNmLHdDQUF5QixDQUFDLGdCQUFnQixlQUFDLENBQUMsQUFDMUMsTUFBTSxDQUFFLE9BQU8sQ0FDZixNQUFNLENBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQ3ZCLGFBQWEsQ0FBRSxHQUFHLENBQ2xCLE9BQU8sQ0FBRSxJQUFJLEFBQUUsQ0FBQyxBQUNoQix3Q0FBeUIsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLGVBQUMsQ0FBQyxBQUM5QyxLQUFLLENBQUUsS0FBSyxDQUNaLE1BQU0sQ0FBRSxLQUFLLEFBQUUsQ0FBQyxBQUNsQix3Q0FBeUIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLGVBQUMsQ0FBQyxBQUM1QyxVQUFVLENBQUUsTUFBTSxBQUFFLENBQUMsQUFDdkIsd0NBQXlCLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxlQUFDLENBQUMsQUFDckQsTUFBTSxDQUFFLElBQUksQ0FDWixPQUFPLENBQUUsS0FBSyxBQUFFLENBQUMifQ== */";
    	append_dev(document.head, style);
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[8] = list[i];
    	child_ctx[10] = i;
    	return child_ctx;
    }

    // (17:2) {:else}
    function create_else_block(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "You haven't uploaded any images yet!";
    			attr_dev(p, "class", "svelte-1t2c4ox");
    			add_location(p, file, 17, 3, 670);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block.name,
    		type: "else",
    		source: "(17:2) {:else}",
    		ctx
    	});

    	return block;
    }

    // (9:2) {#each images as image, i}
    function create_each_block(ctx) {
    	let div;
    	let img;
    	let img_src_value;
    	let t0;
    	let p;
    	let t1_value = /*image*/ ctx[8].name + "";
    	let t1;
    	let t2;
    	let zoo_button;
    	let span;
    	let t4;
    	let dispose;

    	function click_handler(...args) {
    		return /*click_handler*/ ctx[7](/*i*/ ctx[10], ...args);
    	}

    	const block = {
    		c: function create() {
    			div = element("div");
    			img = element("img");
    			t0 = space();
    			p = element("p");
    			t1 = text(t1_value);
    			t2 = space();
    			zoo_button = element("zoo-button");
    			span = element("span");
    			span.textContent = "Remove image";
    			t4 = space();
    			if (img.src !== (img_src_value = /*image*/ ctx[8].data)) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "image");
    			attr_dev(img, "class", "svelte-1t2c4ox");
    			add_location(img, file, 10, 4, 397);
    			attr_dev(p, "class", "svelte-1t2c4ox");
    			add_location(p, file, 11, 4, 500);
    			attr_dev(span, "slot", "buttoncontent");
    			add_location(span, file, 13, 5, 578);
    			set_custom_element_data(zoo_button, "class", "svelte-1t2c4ox");
    			add_location(zoo_button, file, 12, 4, 525);
    			attr_dev(div, "class", "image-thumbnail svelte-1t2c4ox");
    			add_location(div, file, 9, 3, 362);

    			dispose = [
    				listen_dev(img, "load", /*load_handler*/ ctx[6], false, false, false),
    				listen_dev(zoo_button, "click", click_handler, false, false, false)
    			];
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, img);
    			append_dev(div, t0);
    			append_dev(div, p);
    			append_dev(p, t1);
    			append_dev(div, t2);
    			append_dev(div, zoo_button);
    			append_dev(zoo_button, span);
    			append_dev(div, t4);
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty & /*images*/ 1 && img.src !== (img_src_value = /*image*/ ctx[8].data)) {
    				attr_dev(img, "src", img_src_value);
    			}

    			if (dirty & /*images*/ 1 && t1_value !== (t1_value = /*image*/ ctx[8].name + "")) set_data_dev(t1, t1_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(9:2) {#each images as image, i}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let div2;
    	let h2;
    	let t1;
    	let div0;
    	let zoo_input;
    	let input;
    	let t2;
    	let div1;
    	let dispose;
    	let each_value = /*images*/ ctx[0];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	let each_1_else = null;

    	if (!each_value.length) {
    		each_1_else = create_else_block(ctx);
    		each_1_else.c();
    	}

    	const block = {
    		c: function create() {
    			div2 = element("div");
    			h2 = element("h2");
    			h2.textContent = "Image viewer";
    			t1 = space();
    			div0 = element("div");
    			zoo_input = element("zoo-input");
    			input = element("input");
    			t2 = space();
    			div1 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			add_location(h2, file, 1, 1, 20);
    			attr_dev(input, "slot", "inputelement");
    			attr_dev(input, "type", "file");
    			input.multiple = true;
    			attr_dev(input, "accept", ".jpg, .jpeg, .png");
    			add_location(input, file, 4, 3, 127);
    			set_custom_element_data(zoo_input, "labeltext", "Choose images to upload");
    			add_location(zoo_input, file, 3, 2, 75);
    			set_style(div0, "width", "250px");
    			add_location(div0, file, 2, 1, 44);
    			attr_dev(div1, "class", "image-thumbnails-wrapper svelte-1t2c4ox");
    			add_location(div1, file, 7, 1, 289);
    			attr_dev(div2, "class", "app svelte-1t2c4ox");
    			add_location(div2, file, 0, 0, 0);
    			dispose = listen_dev(input, "change", /*change_handler*/ ctx[5], false, false, false);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div2, anchor);
    			append_dev(div2, h2);
    			append_dev(div2, t1);
    			append_dev(div2, div0);
    			append_dev(div0, zoo_input);
    			append_dev(zoo_input, input);
    			/*input_binding*/ ctx[4](input);
    			append_dev(div2, t2);
    			append_dev(div2, div1);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div1, null);
    			}

    			if (each_1_else) {
    				each_1_else.m(div1, null);
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*removeImage, images, window*/ 9) {
    				each_value = /*images*/ ctx[0];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div1, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (each_value.length) {
    				if (each_1_else) {
    					each_1_else.d(1);
    					each_1_else = null;
    				}
    			} else if (!each_1_else) {
    				each_1_else = create_else_block(ctx);
    				each_1_else.c();
    				each_1_else.m(div1, null);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div2);
    			/*input_binding*/ ctx[4](null);
    			destroy_each(each_blocks, detaching);
    			if (each_1_else) each_1_else.d();
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let images = [];
    	let _input;

    	const handleFileUpload = e => {
    		const temp = [...images];

    		for (let i = 0; i < _input.files.length; i++) {
    			const file = _input.files[i];

    			temp.push({
    				data: window.URL.createObjectURL(file),
    				name: file.name
    			});
    		}

    		$$invalidate(0, images = temp);
    		$$invalidate(1, _input.value = null, _input);
    	};

    	const removeImage = idx => {
    		$$invalidate(0, images = images.filter((img, i) => i !== idx));
    	};

    	function input_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(1, _input = $$value);
    		});
    	}

    	const change_handler = e => handleFileUpload();

    	const load_handler = function () {
    		window.URL.revokeObjectURL(this.src);
    	};

    	const click_handler = i => removeImage(i);

    	$$self.$capture_state = () => {
    		return {};
    	};

    	$$self.$inject_state = $$props => {
    		if ("images" in $$props) $$invalidate(0, images = $$props.images);
    		if ("_input" in $$props) $$invalidate(1, _input = $$props._input);
    	};

    	return [
    		images,
    		_input,
    		handleFileUpload,
    		removeImage,
    		input_binding,
    		change_handler,
    		load_handler,
    		click_handler
    	];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		if (!document.getElementById("svelte-1t2c4ox-style")) add_css();
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
    	target: document.body
    });

    return app;

}());
